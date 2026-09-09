import React, { act, Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";

// pnpm dev 실행 후 /tests/todo-render.html을 엽니다.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.todoData = [{ id: "test-list", title: "테스트 목록", todos: [] }];
const { App } = await import("../src/todo/todo.jsx");
const container = document.getElementById("root");
const results = document.getElementById("results");
const passed = [];

try {
  for (const strict of [false, true]) {
    const root = createRoot(container);
    let commits = 0;
    const recordRender = () => {
      commits += 1;
      // 무한 루프가 브라우저를 멈추지 않도록 검사에서만 상한을 둡니다.
      if (commits > 25) throw new Error("목록 등록이 반복 렌더링을 유발함");
    };
    try {
      await act(async () => {
        const app = <Profiler id="todo" onRender={recordRender}><App /></Profiler>;
        root.render(strict ? <StrictMode>{app}</StrictMode> : app);
      });
      if (!container.textContent.includes("테스트 목록")) throw new Error("목록이 표시되지 않음");
      passed.push(`StrictMode=${strict}: 초기 목록 ${commits}회 후 안정화`);

      commits = 0;
      await act(async () => {
        container.querySelector("svg.lucide-plus").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      if (!container.textContent.includes("New List") || !container.textContent.includes("테스트 목록")) {
        throw new Error("새 목록을 추가한 뒤 기존 목록이 유지되지 않음");
      }
      passed.push(`StrictMode=${strict}: 목록 추가 ${commits}회 후 안정화`);

      commits = 0;
      const row = [...container.querySelectorAll("div")].find(el => el.children.length === 0 && el.textContent === "테스트 목록");
      await act(async () => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const title = container.querySelector('input[placeholder="Untitled List"]');
      if (title?.value !== "테스트 목록") throw new Error("인덱스가 이동한 기존 목록을 열지 못함");
      passed.push(`StrictMode=${strict}: 기존 목록 열기 ${commits}회 후 안정화`);
    } finally {
      await act(async () => { root.unmount(); });
    }
  }
  results.textContent = `${passed.length}개 검사 통과\n${passed.join("\n")}`;
} catch (error) {
  results.textContent = `검사 실패: ${String(error)}\n${passed.join("\n")}`;
}
