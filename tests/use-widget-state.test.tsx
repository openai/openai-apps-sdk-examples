import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useWidgetState } from "../src/use-widget-state";

// pnpm dev 실행 후 /tests/use-widget-state.html에서 브라우저로 검사합니다.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.getElementById("root")!;
const results = document.getElementById("results")!;
const passed: string[] = [];
type State = { count: number };
let current: State | null;
let update: (state: React.SetStateAction<State | null>) => void;
const writes: State[] = [];

function Probe({ withDefault }: { withDefault: boolean }) {
  [current, update] = useWidgetState<State>(
    withDefault ? () => ({ count: 2 }) : null
  );
  return <output>{JSON.stringify(current)}</output>;
}

function expectState(expected: State | null, label: string) {
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(current)}`);
  }
  passed.push(label);
}

async function hostUpdate(state: State | null) {
  await act(async () => {
    window.openai.widgetState = state;
    window.dispatchEvent(new CustomEvent("openai:set_globals", {
      detail: { globals: { widgetState: state } },
    }));
  });
}

try {
  for (const strict of [false, true]) {
    for (const initial of [null, { count: 7 }]) {
      for (const withDefault of [false, true]) {
        writes.length = 0;
        window.openai = {
          widgetState: initial,
          setWidgetState: async (state: State) => { writes.push(state); },
        } as typeof window.openai;
        const root = createRoot(container);
        const label = `StrictMode=${strict}, 초기값=${JSON.stringify(initial)}, 기본값=${withDefault}`;
        try {
          await act(async () => {
            const probe = <Probe withDefault={withDefault} />;
            root.render(strict ? <StrictMode>{probe}</StrictMode> : probe);
          });
          expectState(initial ?? (withDefault ? { count: 2 } : null), `${label}: 초기화`);
          await hostUpdate({ count: 11 });
          expectState({ count: 11 }, `${label}: 호스트 복원`);
          await hostUpdate(null);
          expectState(null, `${label}: 호스트 초기화`);
          if (writes.length !== 0) throw new Error("호스트 동기화 중 불필요한 쓰기");
          await act(async () => { update(previous => ({ count: (previous?.count ?? 0) + 1 })); });
          expectState({ count: 1 }, `${label}: 초기화 후 함수형 업데이트`);
          if (!writes.length || writes.some(state => state.count !== 1)) {
            throw new Error("이전 호스트 상태가 다시 저장됨");
          }
        } finally {
          await act(async () => { root.unmount(); });
        }
      }
    }
  }
  results.textContent = `${passed.length}개 검사 통과\n${passed.join("\n")}`;
} catch (error) {
  results.textContent = `검사 실패: ${String(error)}\n${passed.join("\n")}`;
  throw error;
}
