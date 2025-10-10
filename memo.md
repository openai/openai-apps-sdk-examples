2025-10-10

* pnpm run serve 的话会执行定义在package.json里的script里面的东西，也就是"serve -s ./assets -p 4444 --cors"。　-s意味着
  * **有 `-s`（单页模式）** ：
    * 适用于前端框架做的 SPA（React/Vue 等），它们把客户端路由（`/about`、`/users/123`）交给浏览器 JS 处理。
    * 当浏览器访问某路径（比如 `/foo`）且该路径对应的静态文件不存在时，服务器会返回 `index.html`，让前端路由去渲染页面。
    * **如果 `index.html` 本身也不存在** （你的 `assets/` 里通常没有单个入口 `index.html`，而是很多独立 demo 页面），`serve -s` 找不到要返回的 `index.html`，最终就会返回 404。
  * **无 `-s`（普通静态文件模式）** ：
    * 服务器直接把目录当静态文件库来服务，请求 `/pizzaz-map-0038.html` 就去找 `assets/pizzaz-map-0038.html`，存在就返回，不存在就 404。
    * 这是你目前需要的行为（你在 `assets/` 下有许多独立的 `.html` demo 文件）。
  * 可以把-s去掉来解决这个问题
* 调试mcp服务器的方法
  * 参考test_mcp.py
* ngrok http 80
* window.postMessage({
  structuredContent: {
  question: "Do you like cats?",
  choices: ["Yes", "No", "Maybe"]
  }})
