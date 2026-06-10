# 草原杯 H5 现场互动系统

Nuxt + Nitro WebSocket 现场互动工具。主持人在 `/admin` 创建房间和推进环节，参与者用 `/r/<房间码>` 加入并接收按身份裁剪后的内容。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认监听：

```text
http://127.0.0.1:37891
```

`dev` 和 `preview` 都绑定 `0.0.0.0:37891`，方便同一局域网内手机访问。局域网访问时把 `127.0.0.1` 换成电脑的局域网 IP。

## 常用入口

```text
http://127.0.0.1:37891/admin
http://127.0.0.1:37891/r/房间码
```

## 验证

```bash
pnpm typecheck
pnpm build
pnpm test:smoke
```

`test:smoke` 默认连接 `ws://127.0.0.1:37891/ws`，运行前需要先启动 `pnpm dev`。

## 数据

房间状态默认写入 `.data/caoyuan.db`。可用环境变量指定路径：

```bash
CAOYUAN_DB=/path/to/caoyuan.db pnpm dev
```

服务端会按 WebSocket 连接身份裁剪参与者视图，参与者网络层拿不到别人的词、完整投票表或内鬼分配表。
