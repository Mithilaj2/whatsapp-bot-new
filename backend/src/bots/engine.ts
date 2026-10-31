import type { BotFlow, BotNode, RichMessage } from '../db/schema';

/**
 * The bot's brain, with no database or WhatsApp in it: given the flow, where the person is, and
 * what they just sent, it says what to reply and where they are now. The live bot and the
 * "Test chat" in the panel both use it, so what you test is what runs.
 */

export interface BotState {
  status: 'ACTIVE' | 'COMPLETED' | 'HANDOFF';
  /** Step waiting for an answer. */
  nodeId: string | null;
  vars: Record<string, string>;
}

export type BotOutput =
  | { kind: 'text'; text: string }
  | { kind: 'rich'; rich: RichMessage }
  /** Ask the AI this, using the business knowledge. */
  | { kind: 'ai'; question: string };

export interface StepInput {
  text: string;
  /** Id of the tapped button or list row, if any. */
  replyId?: string;
  contactName?: string | null;
}

export interface StepResult {
  outputs: BotOutput[];
  /** Null: no chat going on (nothing to save). */
  state: BotState | null;
  /** A new chat with the flow started with this message. */
  started: boolean;
}

export const LIMITS = {
  nodes: 60,
  buttons: 3,
  buttonTitle: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  listButton: 20,
  interactiveText: 1024,
  text: 4096,
};

const MAX_STEPS = 25;

/** Reply id sent to WhatsApp for an option: unique across the flow. */
export const optionReplyId = (nodeId: string, optionId: string) => `${nodeId}:${optionId}`;

const VALIDATORS: Record<NonNullable<BotNode['validation']>, { test: (v: string) => boolean; error: string }> = {
  TEXT: { test: (v) => v.trim().length > 0, error: 'Please type your answer.' },
  NUMBER: { test: (v) => /^-?\d+([.,]\d+)?$/.test(v.trim().replace(/\s/g, '')), error: 'Please send a number.' },
  EMAIL: { test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()), error: 'Please send a valid email address.' },
  PHONE: { test: (v) => /^\+?\d{8,15}$/.test(v.replace(/[\s()-]/g, '')), error: 'Please send a valid phone number.' },
};

/** Fills {{name}} and {{variable}}; unknown ones become empty. */
export function fillVars(text: string, vars: Record<string, string>, contactName?: string | null) {
  return text.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_, k: string) =>
    k === 'name' ? (vars.name ?? contactName ?? '') : (vars[k] ?? ''),
  );
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The flow's start step for this message, if a keyword matches. */
export function matchTrigger(flow: BotFlow, text: string, exactOnly = false): string | null {
  const t = norm(text);
  if (!t) return null;
  // Exact matches win over "contains", so "price list" can differ from "price"
  for (const tr of flow.triggers) {
    if (tr.match === 'EXACT' && tr.keywords.some((k) => norm(k) === t)) return tr.startNodeId;
  }
  if (exactOnly) return null;
  for (const tr of flow.triggers) {
    if (tr.match === 'CONTAINS' && tr.keywords.some((k) => norm(k) && t.includes(norm(k)))) return tr.startNodeId;
  }
  return null;
}

/** What the bot sends when it arrives at a step (questions and menus included). */
function render(node: BotNode, vars: Record<string, string>, contactName?: string | null): BotOutput[] {
  const text = fillVars(node.text, vars, contactName);
  switch (node.type) {
    case 'BUTTONS':
      return [
        {
          kind: 'rich',
          rich: {
            kind: 'buttons',
            body: text,
            imageUrl: node.imageUrl || undefined,
            buttons: (node.options ?? []).map((o) => ({ id: optionReplyId(node.id, o.id), title: o.title })),
          },
        },
      ];
    case 'LIST':
      return [
        {
          kind: 'rich',
          rich: {
            kind: 'list',
            body: text,
            button: node.listButton || 'Choose',
            rows: (node.options ?? []).map((o) => ({
              id: optionReplyId(node.id, o.id),
              title: o.title,
              description: o.description || undefined,
            })),
          },
        },
      ];
    case 'MESSAGE':
      if (node.imageUrl) return [{ kind: 'rich', rich: { kind: 'image', imageUrl: node.imageUrl, caption: text || undefined } }];
      return text ? [{ kind: 'text', text }] : [];
    default:
      return text ? [{ kind: 'text', text }] : [];
  }
}

/** Walks from a step: sends messages until a step needs an answer or the chat ends. */
function run(flow: BotFlow, startId: string | undefined, vars: Record<string, string>, contactName?: string | null) {
  const outputs: BotOutput[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  let id = startId;
  for (let i = 0; i < MAX_STEPS && id; i++) {
    const node = byId.get(id);
    if (!node) break;
    outputs.push(...render(node, vars, contactName));
    if (node.type === 'BUTTONS' || node.type === 'LIST' || node.type === 'QUESTION') {
      return { outputs, state: { status: 'ACTIVE' as const, nodeId: node.id, vars } };
    }
    if (node.type === 'HANDOFF') {
      return { outputs, state: { status: 'HANDOFF' as const, nodeId: null, vars } };
    }
    id = node.next;
  }
  return { outputs, state: { status: 'COMPLETED' as const, nodeId: null, vars } };
}

/** Which option of a menu the person picked: tapped, typed its title, or typed its number. */
function pickOption(node: BotNode, input: StepInput) {
  const opts = node.options ?? [];
  if (input.replyId) {
    const o = opts.find((x) => optionReplyId(node.id, x.id) === input.replyId);
    if (o) return o;
  }
  const t = norm(input.text);
  const byTitle = opts.find((o) => norm(o.title) === t);
  if (byTitle) return byTitle;
  const n = Number(t.replace(/[.)]$/, ''));
  if (Number.isInteger(n) && n >= 1 && n <= opts.length) return opts[n - 1];
  return null;
}

export function step(flow: BotFlow, current: BotState | null, input: StepInput): StepResult {
  const waiting =
    current?.status === 'ACTIVE' && current.nodeId ? flow.nodes.find((n) => n.id === current.nodeId) : undefined;

  if (waiting && current) {
    const vars = { ...current.vars };

    if (waiting.type === 'BUTTONS' || waiting.type === 'LIST') {
      const opt = pickOption(waiting, input);
      if (opt) {
        vars[`${waiting.variable || waiting.id}`] = opt.title;
        return { ...run(flow, opt.next, vars, input.contactName), started: false };
      }
    } else if (waiting.type === 'QUESTION') {
      // Typing a keyword like "menu" leaves the question instead of becoming the answer
      const leave = input.replyId ? null : matchTrigger(flow, input.text, true);
      if (leave) return { ...run(flow, leave, vars, input.contactName), started: false };
      const v = VALIDATORS[waiting.validation ?? 'TEXT'];
      if (v.test(input.text)) {
        vars[waiting.variable || waiting.id] = input.text.trim().slice(0, 500);
        return { ...run(flow, waiting.next, vars, input.contactName), started: false };
      }
    }

    // Not an answer: a keyword starts over, otherwise ask again
    const restart = matchTrigger(flow, input.text);
    if (restart) return { ...run(flow, restart, vars, input.contactName), started: false };

    const again = render(waiting, vars, input.contactName);
    if (waiting.type === 'QUESTION') {
      const v = VALIDATORS[waiting.validation ?? 'TEXT'];
      return { outputs: [{ kind: 'text', text: v.error }, ...again], state: current, started: false };
    }
    // A question instead of a choice: let the AI answer it, then show the menu again
    const help: BotOutput[] =
      flow.fallback.mode === 'AI' && input.text.trim()
        ? [{ kind: 'ai', question: input.text }]
        : [{ kind: 'text', text: 'Please choose one of the options.' }];
    return { outputs: [...help, ...again], state: current, started: false };
  }

  // No chat going on
  const start = matchTrigger(flow, input.text);
  if (start) return { ...run(flow, start, {}, input.contactName), started: true };

  switch (flow.fallback.mode) {
    case 'START':
      return { ...run(flow, flow.fallback.startNodeId, {}, input.contactName), started: true };
    case 'MESSAGE':
      return {
        outputs: flow.fallback.text ? [{ kind: 'text', text: fillVars(flow.fallback.text, {}, input.contactName) }] : [],
        state: null,
        started: false,
      };
    case 'AI':
      return { outputs: input.text.trim() ? [{ kind: 'ai', question: input.text }] : [], state: null, started: false };
    default:
      return { outputs: [], state: null, started: false };
  }
}

/** Problems that stop a flow from working, in plain words. Empty = fine. */
export function checkFlow(flow: BotFlow): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const names = (n: BotNode) => `"${n.name || n.id}"`;
  if (!flow.nodes.length) errors.push('Add at least one step');
  if (flow.nodes.length > LIMITS.nodes) errors.push(`At most ${LIMITS.nodes} steps`);
  for (const n of flow.nodes) {
    if (ids.has(n.id)) errors.push(`Two steps have the id ${n.id}`);
    ids.add(n.id);
  }
  const exists = (id?: string) => !id || ids.has(id);
  const variables = new Set<string>();

  for (const n of flow.nodes) {
    const label = names(n);
    const interactive = n.type === 'BUTTONS' || n.type === 'LIST';
    if (!n.text.trim() && !(n.type === 'MESSAGE' && n.imageUrl)) errors.push(`${label}: write the message`);
    if (n.text.length > (interactive ? LIMITS.interactiveText : LIMITS.text)) {
      errors.push(`${label}: message is too long (max ${interactive ? LIMITS.interactiveText : LIMITS.text} characters)`);
    }
    if (!exists(n.next)) errors.push(`${label}: the next step no longer exists`);
    if (n.next === n.id) errors.push(`${label}: a step can't lead to itself`);
    if (interactive) {
      const opts = n.options ?? [];
      const max = n.type === 'BUTTONS' ? LIMITS.buttons : LIMITS.listRows;
      const titleMax = n.type === 'BUTTONS' ? LIMITS.buttonTitle : LIMITS.rowTitle;
      if (opts.length < 1 || opts.length > max) errors.push(`${label}: needs 1 to ${max} ${n.type === 'BUTTONS' ? 'buttons' : 'options'}`);
      const seen = new Set<string>();
      for (const o of opts) {
        if (!o.title.trim()) errors.push(`${label}: every option needs a title`);
        if (o.title.length > titleMax) errors.push(`${label}: "${o.title}" is longer than ${titleMax} characters`);
        if ((o.description ?? '').length > LIMITS.rowDescription) errors.push(`${label}: a description is longer than ${LIMITS.rowDescription} characters`);
        if (seen.has(norm(o.title))) errors.push(`${label}: two options are called "${o.title}"`);
        seen.add(norm(o.title));
        if (!exists(o.next)) errors.push(`${label}: option "${o.title}" leads to a step that no longer exists`);
      }
      if (n.type === 'LIST' && (n.listButton ?? '').length > LIMITS.listButton) {
        errors.push(`${label}: menu button text is longer than ${LIMITS.listButton} characters`);
      }
    }
    if (n.type === 'QUESTION') {
      if (!n.variable || !/^[a-zA-Z_]\w{0,39}$/.test(n.variable)) {
        errors.push(`${label}: give the answer a name (letters, numbers and _ only, like company_name)`);
      } else if (variables.has(n.variable)) {
        errors.push(`${label}: another question already saves to "${n.variable}"`);
      } else variables.add(n.variable);
    }
  }

  const seenKeywords = new Map<string, string>();
  for (const t of flow.triggers) {
    if (!t.keywords.some((k) => k.trim())) errors.push('Every keyword trigger needs at least one keyword');
    if (!ids.has(t.startNodeId)) errors.push(`Keywords "${t.keywords.join(', ')}" start at a step that no longer exists`);
    for (const k of t.keywords) {
      const key = `${t.match}:${norm(k)}`;
      if (seenKeywords.has(key)) errors.push(`The keyword "${k}" is used twice`);
      seenKeywords.set(key, t.id);
    }
  }
  if (flow.fallback.mode === 'START' && !ids.has(flow.fallback.startNodeId ?? '')) {
    errors.push('Pick the step to start with when no keyword matches');
  }
  if (flow.fallback.mode === 'MESSAGE' && !flow.fallback.text?.trim()) errors.push('Write the message for when no keyword matches');
  if (flow.fallback.mode === 'AI' && !flow.ai.knowledge.trim()) {
    errors.push('Add your business information so the AI can answer questions');
  }
  return [...new Set(errors)];
}

/** A small starter bot for new bots, so people see how it works. */
export function starterFlow(businessName: string): BotFlow {
  return {
    nodes: [
      {
        id: 'welcome',
        type: 'BUTTONS',
        name: 'Welcome',
        text: `Hi {{name}}! Welcome to ${businessName}. How can we help you today?`,
        options: [
          { id: 'o1', title: 'Our services', next: 'services' },
          { id: 'o2', title: 'Get a callback', next: 'ask_name' },
          { id: 'o3', title: 'Talk to us', next: 'handoff' },
        ],
      },
      {
        id: 'services',
        type: 'MESSAGE',
        name: 'Services',
        text: 'Here is what we offer:\n- Service one\n- Service two\n\nType *menu* anytime to see the options again.',
      },
      {
        id: 'ask_name',
        type: 'QUESTION',
        name: 'Ask name',
        text: 'Sure! What is your name?',
        variable: 'customer_name',
        validation: 'TEXT',
        next: 'ask_phone',
      },
      {
        id: 'ask_phone',
        type: 'QUESTION',
        name: 'Ask phone',
        text: 'Thanks {{customer_name}}. Which number should we call?',
        variable: 'callback_phone',
        validation: 'PHONE',
        next: 'thanks',
      },
      { id: 'thanks', type: 'MESSAGE', name: 'Thanks', text: 'Got it! Our team will call you on {{callback_phone}} soon.' },
      {
        id: 'handoff',
        type: 'HANDOFF',
        name: 'Talk to a person',
        text: 'Okay, a member of our team will reply here shortly.',
      },
    ],
    triggers: [{ id: 't1', keywords: ['hi', 'hello', 'menu', 'start'], match: 'EXACT', startNodeId: 'welcome' }],
    fallback: { mode: 'START', startNodeId: 'welcome' },
    ai: { knowledge: '', noAnswerText: "Sorry, I don't have that information. Our team will get back to you." },
  };
}
