/**
 * Panneau d'interface du module (src/ui/panels/batiments.ts) : montage sur un DOM minimal simulé
 * (le panneau n'utilise que `root.ownerDocument`), commandes émises par les bascules et le formulaire,
 * rendu des listes à la réception d'un delta, démontage propre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batimentsPanel } from '../../src/ui/panels/batiments';
import type { UiPanelApi } from '../../src/ui/panels/types';

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  children: FakeNode[];
  listeners: Map<string, ((e: { preventDefault(): void }) => void)[]>;
  ownerDocument: FakeDoc;
  [k: string]: unknown;
  append(...n: FakeNode[]): void;
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void;
  fire(type: string): void;
  text(): string;
}
interface FakeDoc { createElement(tag: string): FakeNode }

function makeDoc(): FakeDoc {
  const doc: FakeDoc = {
    createElement(tag: string): FakeNode {
      const children: FakeNode[] = [];
      const listeners = new Map<string, ((e: { preventDefault(): void }) => void)[]>();
      const node: FakeNode = {
        tag, className: '', textContent: '', children, listeners, ownerDocument: doc,
        append(...n: FakeNode[]): void {
          children.push(...n);
          // Un <select> prend la valeur de sa première option (comme un vrai DOM).
          if (tag === 'select' && node['value'] === undefined) node['value'] = n.find((c) => c.tag === 'option')?.['value'];
        },
        addEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void { const l = listeners.get(type) ?? []; l.push(fn); listeners.set(type, l); },
        fire(type: string): void { for (const fn of listeners.get(type) ?? []) fn({ preventDefault: () => undefined }); },
        text(): string { return [node.textContent, ...children.map((c) => c.text())].join(' '); },
        setAttribute(): void { /* ignoré */ },
      } as unknown as FakeNode;
      // `textContent = ''` doit vider les enfants (comme dans un vrai DOM).
      let txt = '';
      Object.defineProperty(node, 'textContent', {
        get: () => txt,
        set: (v: string) => { txt = v; if (v === '') children.length = 0; },
      });
      return node;
    },
  };
  return doc;
}

function fakeApi(): { api: UiPanelApi; calls: { name: string; payload?: unknown }[]; emit(p: unknown): void; toasts: string[] } {
  const calls: { name: string; payload?: unknown }[] = [];
  const toasts: string[] = [];
  let listener: ((p: unknown) => void) | null = null;
  const api: UiPanelApi = {
    command: (name, payload) => {
      calls.push(payload === undefined ? { name } : { name, payload });
      if (name === 'listDistricts') return Promise.resolve({ districts: [] });
      if (name === 'listProposals') return Promise.resolve({ proposals: [] });
      if (name === 'planDistrict') return Promise.resolve({ plan: { stats: { roads: 24, roadLength: 2100, lots: 113, distinctAssets: 12, repetitionIndex: 0.03, residents: 900, jobs: 120, cost: 1234 } } });
      return Promise.resolve({});
    },
    onDeltaExt: (fn) => { listener = fn; return () => { listener = null; }; },
    snapshotExt: () => undefined,
    toast: (m) => { toasts.push(m); },
  };
  return { api, calls, emit: (p) => listener?.(p), toasts };
}

test('panneau bâtiments : identité et montage', async () => {
  assert.equal(batimentsPanel.id, 'batiments');
  assert.equal(batimentsPanel.phase, '2A');
  assert.ok(batimentsPanel.mount);
  const doc = makeDoc();
  const root = doc.createElement('div');
  const { api, calls, emit } = fakeApi();
  const unmount = batimentsPanel.mount!(root as unknown as HTMLElement, api);
  // Au montage : lecture de l'état courant.
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(calls.some((c) => c.name === 'listDistricts'));
  assert.ok(root.text().includes('Quartiers suivis'));
  assert.ok(root.text().includes('Aucun quartier suivi.'));

  // Delta : la liste se remplit.
  emit({
    overlay: true, autoEvolve: false,
    districts: [{ id: 1, nameFr: 'Faubourg', buildings: 42, distinctAssets: 9, repetitionIndex: 0.12, value: 61.4, stage: 2, residents: 300, capacity: 400 }],
    proposals: [{ id: 5, kind: 'densification', reason: 'Quartier recherché', cost: 280000 }],
  });
  const txt = root.text();
  assert.ok(txt.includes('Faubourg n° 1'), txt);
  assert.ok(txt.includes('42 bâtiments'));
  assert.ok(txt.includes('valeur 61/100'));
  assert.ok(txt.includes('Densification'));
  assert.ok(txt.includes('Appliquer') && txt.includes('Écarter'));
  assert.equal(typeof unmount, 'function');
  (unmount as () => void)();
  assert.equal(root.text().trim(), '');
});

test('panneau bâtiments : bascules et formulaire émettent les bonnes commandes', async () => {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const { api, calls } = fakeApi();
  batimentsPanel.mount!(root as unknown as HTMLElement, api);
  await Promise.resolve();
  const find = (pred: (n: FakeNode) => boolean): FakeNode | undefined => {
    const stack = [...root.children];
    while (stack.length) { const n = stack.shift()!; if (pred(n)) return n; stack.push(...n.children); }
    return undefined;
  };
  const overlay = find((n) => n['id'] === 'quartiers-overlay')!;
  overlay['checked'] = true;
  overlay.fire('change');
  const auto = find((n) => n['id'] === 'quartiers-auto')!;
  auto['checked'] = true;
  auto.fire('change');
  const form = find((n) => n.tag === 'form')!;
  form.fire('submit');
  const build = find((n) => n.textContent === 'Construire')!;
  build.fire('click');
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const names = calls.map((c) => c.name);
  assert.ok(names.includes('setOverlay'));
  assert.deepEqual(calls.find((c) => c.name === 'setOverlay')?.payload, { on: true });
  assert.deepEqual(calls.find((c) => c.name === 'setAutoEvolve')?.payload, { on: true });
  const plan = calls.find((c) => c.name === 'planDistrict');
  assert.deepEqual(plan?.payload, { type: 'centre_historique', x: 0, z: 0, width: 320, depth: 240, seed: 1 });
  assert.ok(names.includes('applyDistrict'));
  assert.ok(root.text().includes('113 bâtiments'), root.text());
});
