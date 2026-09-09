/**
 * A small SoQL evaluator over in-memory rows.
 *
 * Demo mode routes through this rather than through hand-written fixtures per
 * panel, so the offline dashboard exercises exactly the queries the live client
 * sends. It covers the subset this dashboard uses: projections with aliases,
 * the aggregate functions, `date_extract_y`, boolean predicates with AND/OR/NOT
 * and parentheses, `in`, `IS [NOT] NULL`, `between`, grouping, having, ordering
 * and paging. Anything outside that subset throws rather than quietly
 * returning wrong numbers.
 */

import type { SoqlQuery } from '../lib/soql';

export type Row = Record<string, string | number | null | undefined>;
type Scalar = string | number | boolean | null;

/* ---------------------------------------------------------------- tokenizer */

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const OPERATORS = ['>=', '<=', '!=', '<>', '=', '>', '<', '(', ')', ','];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i++;
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (input[i] === "'") {
          i++;
          break;
        } else {
          value += input[i];
          i++;
        }
      }
      tokens.push({ kind: 'str', value });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < input.length && /[0-9._]/.test(input[j]!)) j++;
      tokens.push({ kind: 'num', value: Number(input.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++;
      tokens.push({ kind: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (!op) throw new Error(`SoQL: unexpected character ${JSON.stringify(ch)} at ${i}`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

/* ------------------------------------------------------------------- parser */

type Node =
  | { type: 'and' | 'or'; left: Node; right: Node }
  | { type: 'not'; operand: Node }
  | { type: 'compare'; op: string; left: Node; right: Node }
  | { type: 'isNull'; operand: Node; negated: boolean }
  | { type: 'in'; operand: Node; values: Node[]; negated: boolean }
  | { type: 'between'; operand: Node; lo: Node; hi: Node }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'field'; name: string }
  | { type: 'literal'; value: Scalar };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t?.kind === 'ident' && t.value.toLowerCase() === word;
  }

  private eatKeyword(word: string): boolean {
    if (!this.isKeyword(word)) return false;
    this.pos++;
    return true;
  }

  private eatOp(op: string): boolean {
    const t = this.peek();
    if (t?.kind === 'op' && t.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(op: string): void {
    if (!this.eatOp(op)) throw new Error(`SoQL: expected ${op}`);
  }

  parseExpression(): Node {
    const node = this.parseOr();
    if (this.pos !== this.tokens.length) throw new Error('SoQL: trailing input in expression');
    return node;
  }

  /** Parses one value expression - used for `$select` and `$order` items. */
  parseOperandOnly(): Node {
    const node = this.parseOperand();
    if (this.pos !== this.tokens.length) throw new Error('SoQL: trailing input in operand');
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.eatKeyword('or')) left = { type: 'or', left, right: this.parseAnd() };
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.eatKeyword('and')) left = { type: 'and', left, right: this.parseNot() };
    return left;
  }

  private parseNot(): Node {
    if (this.eatKeyword('not')) return { type: 'not', operand: this.parseNot() };
    return this.parsePredicate();
  }

  private parsePredicate(): Node {
    // A parenthesised group is only a sub-expression when it wraps a boolean;
    // `(1 = 0)` and `(a AND b)` both land here.
    const next = this.peek();
    if (next?.kind === 'op' && next.value === '(') {
      const save = this.pos;
      this.pos++;
      try {
        const inner = this.parseOr();
        this.expectOp(')');
        return inner;
      } catch {
        this.pos = save;
      }
    }

    const left = this.parseOperand();

    if (this.eatKeyword('is')) {
      const negated = this.eatKeyword('not');
      if (!this.eatKeyword('null')) throw new Error('SoQL: expected NULL after IS');
      return { type: 'isNull', operand: left, negated };
    }

    let negated = false;
    if (this.isKeyword('not')) {
      const save = this.pos;
      this.pos++;
      if (this.isKeyword('in')) negated = true;
      else this.pos = save;
    }

    if (this.eatKeyword('in')) {
      this.expectOp('(');
      const values: Node[] = [];
      if (!this.eatOp(')')) {
        do {
          values.push(this.parseOperand());
        } while (this.eatOp(','));
        this.expectOp(')');
      }
      return { type: 'in', operand: left, values, negated };
    }

    if (this.eatKeyword('between')) {
      const lo = this.parseOperand();
      if (!this.eatKeyword('and')) throw new Error('SoQL: expected AND in BETWEEN');
      const hi = this.parseOperand();
      return { type: 'between', operand: left, lo, hi };
    }

    const t = this.peek();
    if (t?.kind === 'op' && ['=', '!=', '<>', '>', '<', '>=', '<='].includes(t.value)) {
      this.pos++;
      return { type: 'compare', op: t.value, left, right: this.parseOperand() };
    }

    // A bare call such as `starts_with(merk, 'VOL')` is already a predicate.
    return left;
  }

  private parseOperand(): Node {
    const t = this.peek();
    if (!t) throw new Error('SoQL: unexpected end of input');

    if (t.kind === 'num') {
      this.pos++;
      return { type: 'literal', value: t.value };
    }
    if (t.kind === 'str') {
      this.pos++;
      return { type: 'literal', value: t.value };
    }
    if (t.kind === 'op' && t.value === '(') {
      this.pos++;
      const inner = this.parseOperand();
      this.expectOp(')');
      return inner;
    }
    if (t.kind === 'ident') {
      this.pos++;
      const lower = t.value.toLowerCase();
      if (lower === 'null') return { type: 'literal', value: null };
      if (lower === 'true') return { type: 'literal', value: true };
      if (lower === 'false') return { type: 'literal', value: false };

      if (this.eatOp('(')) {
        const args: Node[] = [];
        if (!this.eatOp(')')) {
          do {
            args.push(this.parseOperand());
          } while (this.eatOp(','));
          this.expectOp(')');
        }
        return { type: 'call', name: lower, args };
      }
      return { type: 'field', name: t.value };
    }
    throw new Error(`SoQL: unexpected token ${JSON.stringify(t)}`);
  }
}

/** `count(*)` is legal SoQL but `*` is not an operand in this grammar. */
const normalise = (source: string): string => source.replace(/\(\s*\*\s*\)/g, '(1)');

function parsePredicateSource(source: string): Node {
  return new Parser(tokenize(normalise(source))).parseExpression();
}

function parseOperandSource(source: string): Node {
  return new Parser(tokenize(normalise(source))).parseOperandOnly();
}

/* ---------------------------------------------------------------- evaluator */

const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']);

function isAggregate(node: Node): boolean {
  if (node.type === 'call') {
    if (AGGREGATES.has(node.name)) return true;
    return node.args.some(isAggregate);
  }
  return false;
}

function asNumber(value: Scalar): number | null {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Comparison follows SoQL: numeric when either side is numeric, else string. */
function compare(a: Scalar, b: Scalar): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = asNumber(a);
    const nb = asNumber(b);
    if (na === null || nb === null) return null;
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

function evalScalar(node: Node, row: Row): Scalar {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'field': {
      const v = row[node.name];
      if (v === undefined || v === null || v === '') return null;
      return v;
    }
    case 'call': {
      const name = node.name;
      const arg0 = node.args[0] ? evalScalar(node.args[0], row) : null;
      switch (name) {
        case 'date_extract_y':
          return arg0 === null ? null : Number(String(arg0).slice(0, 4));
        case 'date_extract_m':
          return arg0 === null ? null : Number(String(arg0).slice(5, 7));
        case 'date_trunc_y':
          return arg0 === null ? null : `${String(arg0).slice(0, 4)}-01-01T00:00:00.000`;
        case 'date_trunc_ym':
          return arg0 === null ? null : `${String(arg0).slice(0, 7)}-01T00:00:00.000`;
        case 'upper':
          return arg0 === null ? null : String(arg0).toUpperCase();
        case 'lower':
          return arg0 === null ? null : String(arg0).toLowerCase();
        case 'starts_with': {
          const prefix = node.args[1] ? evalScalar(node.args[1], row) : null;
          if (arg0 === null || prefix === null) return false;
          return String(arg0).startsWith(String(prefix));
        }
        default:
          throw new Error(`SoQL: unsupported function ${name}`);
      }
    }
    default:
      return evalPredicate(node, row);
  }
}

function evalPredicate(node: Node, row: Row): boolean {
  switch (node.type) {
    case 'and':
      return evalPredicate(node.left, row) && evalPredicate(node.right, row);
    case 'or':
      return evalPredicate(node.left, row) || evalPredicate(node.right, row);
    case 'not':
      return !evalPredicate(node.operand, row);
    case 'isNull': {
      const v = evalScalar(node.operand, row);
      return node.negated ? v !== null : v === null;
    }
    case 'in': {
      const v = evalScalar(node.operand, row);
      const hit = node.values.some((candidate) => compare(v, evalScalar(candidate, row)) === 0);
      return node.negated ? !hit : hit;
    }
    case 'between': {
      const v = evalScalar(node.operand, row);
      const lo = compare(v, evalScalar(node.lo, row));
      const hi = compare(v, evalScalar(node.hi, row));
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    case 'compare': {
      const c = compare(evalScalar(node.left, row), evalScalar(node.right, row));
      if (c === null) return false;
      switch (node.op) {
        case '=':
          return c === 0;
        case '!=':
        case '<>':
          return c !== 0;
        case '>':
          return c > 0;
        case '<':
          return c < 0;
        case '>=':
          return c >= 0;
        case '<=':
          return c <= 0;
        default:
          throw new Error(`SoQL: unsupported operator ${node.op}`);
      }
    }
    default: {
      const v = evalScalar(node, row);
      return v === true || (typeof v === 'number' && v !== 0);
    }
  }
}

function evalAggregate(node: Node, rows: Row[]): Scalar {
  if (node.type !== 'call') return rows.length > 0 ? evalScalar(node, rows[0]!) : null;

  if (node.name === 'count') {
    const arg = node.args[0];
    if (!arg || arg.type === 'literal') return rows.length;
    return rows.reduce((n, row) => (evalScalar(arg, row) === null ? n : n + 1), 0);
  }
  if (node.name === 'count_distinct') {
    const arg = node.args[0]!;
    const seen = new Set<string>();
    for (const row of rows) {
      const v = evalScalar(arg, row);
      if (v !== null) seen.add(String(v));
    }
    return seen.size;
  }

  const arg = node.args[0]!;
  const values = rows
    .map((row) => asNumber(evalScalar(arg, row)))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  switch (node.name) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      throw new Error(`SoQL: unsupported aggregate ${node.name}`);
  }
}

/* -------------------------------------------------------------- select list */

interface SelectItem {
  alias: string;
  node: Node;
  aggregate: boolean;
}

/** Splits on commas that sit outside parentheses and quotes. */
function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      current += ch;
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") {
      quoted = true;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSelect(select: string): SelectItem[] {
  return splitTopLevel(select).map((raw) => {
    const match = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(raw);
    const expression = match ? raw.slice(0, match.index) : raw;
    const node = parseOperandSource(expression);
    const fallback =
      node.type === 'field'
        ? node.name
        : node.type === 'call'
          ? `${node.name}_${node.args[0]?.type === 'field' ? node.args[0].name : 'expr'}`
          : 'value';
    return { alias: match ? match[1]! : fallback, node, aggregate: isAggregate(node) };
  });
}

/* -------------------------------------------------------------- entry point */

export function runSoql(rows: Row[], query: SoqlQuery): Row[] {
  let working = rows;

  if (query.where) {
    const predicate = parsePredicateSource(query.where);
    working = working.filter((row) => evalPredicate(predicate, row));
  }

  const selectItems = query.select ? parseSelect(query.select) : null;
  const groupKeys = query.group ? splitTopLevel(query.group).map(parseOperandSource) : null;
  const grouped = groupKeys !== null || (selectItems?.some((s) => s.aggregate) ?? false);

  let result: Row[];

  if (!grouped) {
    result = selectItems
      ? working.map((row) => {
          const out: Row = {};
          for (const item of selectItems) {
            const v = evalScalar(item.node, row);
            out[item.alias] = v === null ? undefined : typeof v === 'boolean' ? String(v) : v;
          }
          return out;
        })
      : working.slice();
  } else {
    const buckets = new Map<string, { key: Scalar[]; rows: Row[] }>();
    if (groupKeys === null) {
      buckets.set('', { key: [], rows: working });
    } else {
      for (const row of working) {
        const key = groupKeys.map((node) => evalScalar(node, row));
        const id = JSON.stringify(key);
        const bucket = buckets.get(id);
        if (bucket) bucket.rows.push(row);
        else buckets.set(id, { key, rows: [row] });
      }
    }

    const items =
      selectItems ??
      (groupKeys ?? []).map((node, i) => ({
        alias: node.type === 'field' ? node.name : `key_${i}`,
        node,
        aggregate: false,
      }));

    result = [];
    for (const bucket of buckets.values()) {
      const out: Row = {};
      for (const item of items) {
        const v = item.aggregate
          ? evalAggregate(item.node, bucket.rows)
          : evalScalar(item.node, bucket.rows[0]!);
        out[item.alias] = v === null ? undefined : typeof v === 'boolean' ? String(v) : v;
      }
      result.push(out);
    }

    if (query.having) {
      const predicate = parsePredicateSource(query.having);
      result = result.filter((row) => evalPredicate(predicate, row));
    }
  }

  if (query.order) {
    const terms = splitTopLevel(query.order).map((raw) => {
      const desc = /\s+desc\s*$/i.test(raw);
      const expression = raw.replace(/\s+(asc|desc)\s*$/i, '');
      return { node: parseOperandSource(expression), desc };
    });
    // After grouping, an ordering term usually names a select alias rather than
    // a source column, so prefer the already-projected value when present.
    const read = (row: Row, node: Node): Scalar =>
      node.type === 'field' && node.name in row ? ((row[node.name] ?? null) as Scalar) : evalScalar(node, row);

    result = result.slice().sort((a, b) => {
      for (const term of terms) {
        const av = read(a, term.node);
        const bv = read(b, term.node);
        if (av === null && bv === null) continue;
        if (av === null) return 1;
        if (bv === null) return -1;
        const c = compare(av, bv);
        if (c !== null && c !== 0) return term.desc ? -c : c;
      }
      return 0;
    });
  }

  const offset = query.offset ?? 0;
  const limit = query.limit ?? 1000;
  return result.slice(offset, offset + limit);
}
