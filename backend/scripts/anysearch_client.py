"""AnySearch MCP (Streamable HTTP) 的最小 Python 客户端。

端点与鉴权见官方文档：
https://github.com/anysearch-ai/anysearch-mcp-server
"""
import json
import os

import requests
from dotenv import load_dotenv

load_dotenv()

MCP_URL = os.getenv("ANYSEARCH_MCP_URL", "https://api.anysearch.com/mcp")


class AnySearchError(RuntimeError):
    pass


class AnySearch:
    def __init__(self, api_key=None, timeout=60):
        self.api_key = api_key or os.getenv("ANYSEARCH_API_KEY")
        if not self.api_key:
            raise AnySearchError("未找到 ANYSEARCH_API_KEY，请在 .env 中配置。")
        self.timeout = timeout
        self._id = 0
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "X-Anysearch-Client": "mcp/1.0.0",
            }
        )
        self._initialized = False

    @staticmethod
    def _parse(resp):
        """响应可能是 JSON，也可能是 SSE（data: {...}）。"""
        ctype = resp.headers.get("Content-Type", "")
        if "text/event-stream" in ctype:
            for line in resp.text.splitlines():
                if line.startswith("data:"):
                    payload = line[5:].strip()
                    if payload:
                        return json.loads(payload)
            raise AnySearchError("SSE 响应中没有 data 事件")
        return resp.json()

    def _rpc(self, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self._id += 1
            body["id"] = self._id
        resp = self._session.post(MCP_URL, json=body, timeout=self.timeout)
        if resp.status_code == 401:
            raise AnySearchError("401 未授权：API Key 无效或已过期")
        if resp.status_code == 429:
            raise AnySearchError("429 触发限流，请稍后重试")
        resp.raise_for_status()
        sid = resp.headers.get("Mcp-Session-Id")
        if sid:
            self._session.headers["Mcp-Session-Id"] = sid
        if notify or not resp.content:
            return None
        data = self._parse(resp)
        if "error" in data:
            raise AnySearchError(str(data["error"]))
        return data.get("result")

    def _ensure_init(self):
        if self._initialized:
            return
        self._rpc(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "acc-test", "version": "1.0.0"},
            },
        )
        self._rpc("notifications/initialized", notify=True)
        self._initialized = True

    def list_tools(self):
        self._ensure_init()
        return self._rpc("tools/list")["tools"]

    def call(self, tool, **arguments):
        self._ensure_init()
        result = self._rpc("tools/call", {"name": tool, "arguments": arguments})
        text = "\n".join(
            c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"
        )
        if result.get("isError"):
            raise AnySearchError(text or "工具调用失败")
        return text

    def search(self, query, **kwargs):
        return self.call("search", query=query, **kwargs)

    def batch_search(self, queries):
        return self.call("batch_search", queries=[{"query": q} for q in queries])

    def extract(self, url):
        return self.call("extract", url=url)
