import { NODE_LIMIT, plain, putEdge, putNode, type DiagramBody, type Edge, type Line, type Node } from "./authored-kit.js";

/**
 * Mermaid notations beyond flowcharts, sequences, states and entities. Each parser
 * keeps the authored names, order and source lines; a statement it does not fully
 * support leaves the whole block as raw text.
 */

type Field = NonNullable<Node["fields"]>[number];
type Cardinality = NonNullable<Edge["cardinality"]>["from"];

/* ------------------------------ class diagrams ------------------------------ */

const className = "[A-Za-z_][A-Za-z0-9_]{0,63}";
const classRelation = new RegExp(
  `^(${className})\\s+(?:"([^"]{1,12})"\\s+)?(<\\|--|--\\|>|<\\|\\.\\.|\\.\\.\\|>|\\*--|--\\*|o--|--o|<--|-->|<\\.\\.|\\.\\.>|--|\\.\\.)\\s+(?:"([^"]{1,12})"\\s+)?(${className})(?:\\s*:\\s*(.+))?$`
);
// For each arrow: whether the relation starts at the right-hand class, its default label and line.
const classArrows: Record<string, { reversed: boolean; label?: string; dashed?: boolean }> = {
  "<|--": { reversed: true, label: "extends" }, "--|>": { reversed: false, label: "extends" },
  "<|..": { reversed: true, label: "implements", dashed: true }, "..|>": { reversed: false, label: "implements", dashed: true },
  "*--": { reversed: false, label: "owns" }, "--*": { reversed: true, label: "owns" },
  "o--": { reversed: false, label: "has" }, "--o": { reversed: true, label: "has" },
  "-->": { reversed: false }, "<--": { reversed: true },
  "..>": { reversed: false, label: "uses", dashed: true }, "<..": { reversed: true, label: "uses", dashed: true },
  "--": { reversed: false }, "..": { reversed: false, dashed: true }
};
const multiplicities: Record<string, Cardinality> = {
  "1": "1", "0..1": "0..1", "1..*": "1..*", "1..n": "1..*", "0..*": "0..*", "0..n": "0..*", "*": "0..*", "n": "0..*", "many": "0..*"
};

function classMember(text: string, source: Line["source"]): Field | undefined {
  const line = text.replace(/^[+\-#~]\s*/, "").replace(/[*$]$/, "").trim();
  const method = /^([A-Za-z_]\w*)\(([^()]*)\)\s*:?\s*(.*)$/.exec(line);
  if (method) {
    const name = plain(`${method[1]}(${method[2].trim()})`, 64);
    const type = method[3].trim() ? plain(method[3], 60) : "method";
    return name && type ? { name, type, source } : undefined;
  }
  const named = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(line) ?? undefined;
  const typed = named ? undefined : /^(.+?)\s+([A-Za-z_]\w*)$/.exec(line) ?? undefined;
  const name = named?.[1] ?? typed?.[2] ?? (/^[A-Za-z_]\w*$/.test(line) ? line : undefined);
  const type = named ? plain(named[2], 60) : typed ? plain(typed[1], 60) : "value";
  return name && type ? { name, type, source } : undefined;
}

export function classDiagram(lines: Line[], body: DiagramBody): boolean {
  const declare = (id: string, source: Line["source"]): Node | undefined => {
    if (!body.nodes.has(id)) body.nodes.set(id, { id, label: id, source });
    return body.nodes.size <= NODE_LIMIT ? body.nodes.get(id) : undefined;
  };
  const addMember = (owner: Node, text: string, source: Line["source"]): boolean => {
    const member = classMember(text, source);
    if (!member) return false;
    owner.fields ??= [];
    if (owner.fields.length >= 40 || owner.fields.some(({ name }) => name === member.name)) return false;
    owner.fields.push(member);
    return true;
  };
  let open: Node | undefined;
  for (const { text, source } of lines) {
    if (open) {
      if (text === "}") { open = undefined; continue; }
      if (/^<<[A-Za-z ]{1,24}>>$/.test(text)) continue;
      if (!addMember(open, text, source)) return false;
      continue;
    }
    if (/^direction (?:TB|TD|BT|RL|LR)$/.test(text)) continue;
    const annotated = new RegExp(`^<<[A-Za-z ]{1,24}>>\\s+(${className})$`).exec(text);
    if (annotated) {
      if (!declare(annotated[1], source)) return false;
      continue;
    }
    const declaration = new RegExp(`^class (${className})\\s*(\\{)?$`).exec(text);
    if (declaration) {
      const node = declare(declaration[1], source);
      if (!node) return false;
      if (declaration[2]) open = node;
      continue;
    }
    const relation = classRelation.exec(text);
    if (relation) {
      const [, left, leftEnd, arrow, rightEnd, right, rawLabel] = relation;
      const shape = classArrows[arrow];
      const label = rawLabel === undefined ? shape.label : plain(rawLabel, 48);
      if (rawLabel !== undefined && !label || !declare(left, source) || !declare(right, source)) return false;
      const [from, to] = shape.reversed ? [right, left] : [left, right];
      const ends = [multiplicities[leftEnd ?? ""], multiplicities[rightEnd ?? ""]];
      const [fromEnd, toEnd] = shape.reversed ? [ends[1], ends[0]] : ends;
      if (!putEdge(body, { from, to, label, kind: shape.dashed ? "dashed" : "solid", source,
        cardinality: fromEnd && toEnd ? { from: fromEnd, to: toEnd } : undefined })) return false;
      continue;
    }
    const member = new RegExp(`^(${className})\\s*:\\s*(.+)$`).exec(text);
    const owner = member && declare(member[1], source);
    if (!member || !owner || !addMember(owner, member[2], source)) return false;
  }
  return !open;
}

/* ----------------------------------- C4 ----------------------------------- */

/** Macro arguments: quoted strings may hold commas; `$name="value"` settings are ignored. */
function macroArguments(text: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (quoted) return undefined;
  parts.push(current);
  const values: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (!value || value.startsWith("$")) continue;
    const bare = value.replace(/^"(.*)"$/, "$1").trim();
    if (bare.includes('"')) return undefined;
    values.push(bare);
  }
  return values;
}

export function c4(lines: Line[], body: DiagramBody): boolean {
  const groups: string[] = [];
  for (const { text, source } of lines) {
    if (text === "}") {
      if (!groups.pop()) return false;
      continue;
    }
    if (/^title\s+\S/.test(text) || /^Update[A-Za-z]+\(.*\)$/.test(text)) continue;
    const macro = /^([A-Za-z_]+)\((.*)\)\s*(\{)?$/.exec(text);
    const args = macro && macroArguments(macro[2]);
    if (!macro || !args) return false;
    const [, name, , opens] = macro;
    if (/^(?:Enterprise_|System_|Container_)?Boundary$|^(?:Deployment_)?Node(?:_[LR])?$/.test(name)) {
      const label = plain(args[1] ?? args[0] ?? "", 40);
      if (!opens || !label || groups.length >= 4) return false;
      groups.push(label);
      continue;
    }
    if (opens) return false;
    if (/^(?:Bi)?Rel(?:_[A-Za-z_]+)?$|^RelIndex$/.test(name)) {
      const [first, second, rawLabel] = name === "RelIndex" ? args.slice(1) : args;
      const label = rawLabel === undefined ? undefined : plain(rawLabel, 48);
      if (!first || !second || !body.nodes.has(first) || !body.nodes.has(second) || rawLabel !== undefined && !label) return false;
      const [from, to] = /^Rel_Back/.test(name) ? [second, first] : [first, second];
      if (!putEdge(body, { from, to, label, kind: "solid", source })) return false;
      continue;
    }
    const element = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?$/.exec(name);
    const id = args[0];
    const label = plain(args[1] ?? "", 80);
    if (!element || !id || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(id) || !label || body.nodes.has(id)) return false;
    const hint = element[1] === "Person" ? "actor" : element[2] === "Db" ? "store" : element[2] === "Queue" ? "queue"
      : element[3] ? "external" : undefined;
    const icon = hint === "actor" ? "user" : hint === "store" ? "database" : undefined;
    if (!putNode(body, { id, label, hint, icon, group: groups.at(-1) }, source)) return false;
  }
  return groups.length === 0;
}

/* ------------------------- gantt, journey, timeline ------------------------- */

/** An ordered list of labelled steps under optional sections; `entry` reads one line or rejects it. */
function ordered(lines: Line[], body: DiagramBody, settings: RegExp, entry: (text: string, last: Node | undefined) => string | true | undefined): boolean {
  let group: string | undefined;
  let last: Node | undefined;
  for (const { text, source } of lines) {
    if (settings.test(text)) continue;
    const section = /^section\s+(.+)$/.exec(text);
    if (section) {
      group = plain(section[1], 40);
      if (!group) return false;
      continue;
    }
    const label = entry(text, last);
    if (label === true) continue;
    if (!label) return false;
    const id = `step-${body.nodes.size + 1}`;
    if (!putNode(body, { id, label, group }, source)) return false;
    last = body.nodes.get(id);
  }
  return true;
}

export function gantt(lines: Line[], body: DiagramBody): boolean {
  return ordered(lines, body, /^(?:title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|weekend)\s+\S/, (text) => {
    const task = /^([^:]+):\s*\S/.exec(text);
    return task ? plain(task[1], 80) : undefined;
  });
}

export function journey(lines: Line[], body: DiagramBody): boolean {
  return ordered(lines, body, /^title\s+\S/, (text) => {
    const task = /^([^:]+):\s*([1-5])(?:\s*:\s*.+)?$/.exec(text);
    const name = task && plain(task[1], 70);
    return name ? `${name} (${task[2]}/5)` : undefined;
  });
}

export function timeline(lines: Line[], body: DiagramBody): boolean {
  return ordered(lines, body, /^title\s+\S/, (text, last) => {
    const events = text.split(/\s+:\s+|^:\s+/).map((part) => part.trim()).filter(Boolean);
    if (text.startsWith(":")) {
      // A continuation line adds events to the period above it.
      const longer = last && plain(`${last.label}; ${events.join("; ")}`, 140);
      if (!last || !longer) return undefined;
      last.label = longer;
      return true;
    }
    const [period, ...rest] = events;
    return period ? plain(rest.length ? `${period}: ${rest.join("; ")}` : period, 140) : undefined;
  });
}

/* --------------------------------- mindmap --------------------------------- */

const mindmapShape = /^(?:[A-Za-z_][\w-]{0,63})?(?:\(\((.+)\)\)|\)\)(.+)\(\(|\{\{(.+)\}\}|\[(.+)\]|\)(.+)\(|\((.+)\))$/;

export function mindmap(lines: Line[], body: DiagramBody): boolean {
  const path: { indent: number; id: string }[] = [];
  for (const { text, indent, source } of lines) {
    if (/^::icon\(.*\)$/.test(text)) continue;
    const bare = text.replace(/:::[\w -]+$/, "").trim();
    const shaped = mindmapShape.exec(bare);
    const label = plain(shaped ? shaped.slice(1).find(Boolean) ?? "" : bare, 80);
    if (!label || !shaped && /[()[\]{}]/.test(bare)) return false;
    while (path.length && path.at(-1)!.indent >= indent) path.pop();
    const parent = path.at(-1);
    // A mindmap has one root; a second top-level entry is not one diagram.
    if (!parent && body.nodes.size) return false;
    const id = `topic-${body.nodes.size + 1}`;
    if (!putNode(body, { id, label }, source)) return false;
    if (parent && !putEdge(body, { from: parent.id, to: id, kind: "solid", source })) return false;
    path.push({ indent, id });
  }
  return body.nodes.size > 1;
}
