# Task P2 — Focus {{DELIVERABLE}}: {{BUILDING_TITLE}}

Assigned building id: "{{BUILDING_ID}}". Source module: "{{MODULE_REF}}".
User brief as data: {{BRIEF}}. Content language: {{CONTENT_LANGUAGE}}.

Produce one small deliverable. {{FOCUS_RULE}}
{{WORKSPACE_MODE}}
{{SCENARIO_REQUIREMENT}}
{{DECISION_REQUIREMENT}}
{{NARROWER}}
If repairing a prior answer, address this issue as data: {{REPAIR_ISSUE}}

Use a source object such as `{"path":"src/form.js","startLine":12,"endLine":14}`.
Copy the relative `path` from the evidence and use its original inclusive,
one-based line numbers. Use equal start and end lines for a single-line claim.
Each numbered evidence line is prefixed `line |`. Cite the printed line number
where the exact action, condition, result, write or assertion appears. For a
specific example state or timestamp, cite the assertion including its values.
Every included node, edge, replay step and question needs its own source object.
When there are no docs, follow the code excerpt from its entrypoint to the
owning symbol, decision, calls, writes, or tests. Keep uncertain claims absent.
When sources disagree about executable behavior, follow the implementation and
tests. A tutorial or runbook is evidence for documented steps and expectations.
When a diagram faithfully adapts a supplied Mermaid fence, set its top-level
`origin` to `"mermaid"` and `source` to that exact fence range. When a diagram or
lesson summary actually uses a supplied documentation section, cite that exact
section as its top-level source and set diagram origin to `"docs"`. Use
`"code"` when the diagram is derived from implementation. Cite individual
nodes, edges and replay behavior at their own supporting code or test lines
whenever they describe execution. Do not attach a document solely to improve coverage.

Already accepted companion views as data, for consistent names and roles.
Verify every new claim against its own source:

```json
{{COMPANION_JSON}}
```

Indexed documentation excerpts, including diagram source when applicable:

```json
{{DOCS_JSON}}
```

Ranked source and test excerpts:

```json
{{CODE_SIGNALS_JSON}}
```

Return one complete JSON object with top-level `diagrams`, `flows`, and `questions`
arrays. Put the assigned array first. For a scenario, finish `flows` with every
required replay trace before adding optional questions. Leave `diagrams` empty
for a scenario so the dedicated diagram passes handle those views. On the
smaller scenario retry, leave `questions` empty as well. Keep captions concise and reuse
existing step IDs for shared paths and bounded retries. Use an empty array for a
non-applicable deliverable. Omit a node, edge or step when you cannot cite it.

- Diagram: `{id,owner,title,kind,nodes,edges,note?,source?,origin?,claims?}`. `owner` must be
  "{{BUILDING_ID}}". Node `{id,label,group?,icon?,hint?,fields?,source}` and edge
  `{id,from,to,label?,guard?,kind?,source}` IDs must be unique in that diagram.
  A component map uses `kind:"graph"` and includes at least two nodes and one
  directed edge. Each edge's `from` and `to` must match node IDs in that graph.
  Write short labels for the 3D cards and group by real ownership when supported.
  Use `kind:"async"` for async dispatch and `"return"` for responses. Use
  `kind:"state"` with state, initial and terminal nodes for a state diagram.
  For Explain, add three to six useful claims when the packet supports them.
  Keep each claim distinct from a title or label. Address requested rules and
  decisions in the component map. Claim shape
  `{id,target:{kind:"node"|"edge",id},kind,text,evidence:[{kind:"code"|"docs"|"test",path,startLine,endLine}],replay?}`.
  Allowed claim kinds are `responsibility`, `input`, `output`, `guard`,
  `invariant`, `decision`, and `disagreement`. Cite one to three exact spans
  shown in this packet, each at most 40 lines. Use the actual guard, write or
  test assertion for executable claims. For a design decision, quote its
  rationale exactly from the supplied authored documentation. When a supplied
  quote choice matches, use `quoteId` in place of `text` and `evidence` on the
  `decision` claim and target its actual graph node or edge. For disagreement,
  identify what differs and cite both the authored documentation and code or
  test evidence. Leave unsupported reasons absent. Never invent intent from
  an implementation detail. Optional claim replay must use the accepted flow,
  scenario and exact step occurrence when known. Never emit fingerprint or stale.
- Flow: `{id,title,scope,kind,path,branches?,scenarios,source?}`. Scope must
  be "module:{{BUILDING_ID}}". Each step has `{id,ref,actor?,caption,detail?,state?,source}`.
  For a local step use `ref:"step:<slug>"`. Use `state:[{key,value}]` for a verified
  initial or changed status, with the exact name and value from code or tests.
  When the first event creates an item with a known initial status, show it and
  cite the code that sets it or a test that asserts it. Put invariant initial
  state on the shared step, so every trace shows it. If a scenario overrides
  that step with example-specific values, repeat the invariant fields in the
  override. Verify the first and final displayed state for every trace.
  Put changing input, output, status or time in occurrence state. Shared step state
  must stay true each time the step is reused.
  A branch `{id,at,from,condition,path,join?}` starts at a main-path point by
  zero-based `at` and stable `from` id. `join` is an optional main-path step id.
  For main step IDs `open, validate, confirm`, a terminal invalid branch is
  `at:1, from:"validate", path:[error]`. Its trace is `["open","validate","error"]`.
  The valid trace is `["open","validate","confirm"]`. A trace cannot jump to
  a step in another branch or continue after a terminal branch.
  Each scenario `{id,title,summary?,steps,events?}` begins at the first main step and
  lists adjacent step ids through the final main step or the final step of a
  branch without a join. Add `events:[{stepIndex,detail?,state?,source}]` when
  one occurrence needs its own sourced explanation or display state. `stepIndex`
  is zero-based in this scenario's `steps`. The event `state` is the complete
  display state for that position. Keep shared details on the step itself.
  A plain action → operation → result can be a complete replay. Add alternate
  branches only when the evidence shows the conditions and outcomes. Every
  authored main transition and branch, including rejoins, must be demonstrated by
  at least one named trace. For traces with the same steps, distinguish real
  examples with sourced occurrence state. Keep real secret values out of state.
- Optional question `{id,title?,kind,prompt,options,answer,explanation,source,building?,replay?}`.
  Use `choice`, `order`, or `target`. Options are `{id,label}`. `answer` lists
  one option ID, or every option ID in order for an `order` question. `source`
  must have an exact start line. `replay` may include `{flow,scenario?,step?,stepIndex?}`.
  Set `scenario`, `step` and `stepIndex` together for any question about a specific
  event in a trace. Cite the exact event assertion for occurrence-specific
  questions. If the brief asks to find a rule, ask which guard or source
  explains a concrete outcome and link to that replay occurrence. With
  `steps:["start","check","edit","check","end"]`, the
  second check is `{step:"check",stepIndex:3}` in that scenario.
