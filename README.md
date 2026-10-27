# MOTO GPS navigation gateway (Vercel)

自建导航网关：把高德 Web 服务（POI 搜索、驾车路线、行政区划）包在自己的 HTTPS 域名后面，
并为骑行界面按需返回 OSM 道路与建筑瓦片。客户端只需要一个网关根地址。

```text
iPhone → https://YOUR-DOMAIN/api → Vercel Function
                                → 高德 Web 服务（搜索 / 路线 / 城市）
                                → Protomaps PMTiles（按需 Range 读取道路 / 建筑）
```

接口协议固定为 `protocol_version: 1`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/healthz` | 能力与地图源状态（不请求上游） |
| GET | `/api/v1/places?keywords=…` | 地点搜索，可选 `region`、`longitude_deg`/`latitude_deg` |
| POST | `/api/v1/routes` | 单条路线 |
| POST | `/api/v1/route-options` | 最多 3 条候选路线 |
| GET | `/api/v1/map/cities?keywords=…` | 行政区域范围（离线地图下载用） |
| GET | `/api/v1/map/tiles/{z}/{x}/{y}` | z=15 矢量瓦片，转成 GCJ-02 道路/建筑 JSON |

## 来源与许可

本仓库是从 [moto-gps-waveshare](https://github.com/mx3353672833-debug/moto-gps-waveshare) 的
`backend/` 抽出的 Vercel 部署形态，网关逻辑、校验、协议与错误码与该上游一致；
上游还提供 Node.js 常驻服务器和 Cloudflare Workers + R2 两种宿主。
修 bug 请同时反馈上游，避免两份代码分叉。

与上游的差异只有三处：新增 `api/` + `lib/` 的 Vercel 宿主适配，新增
`scripts/publish_firmware.mjs` 与 `public/firmware/` 的 OTA 托管（上游布局是
`backend/public/`），以及把 `test/schema.test.js` 读取协议 schema 的相对路径改成本仓库布局
（`shared/protocol/`，只保留三个 JSON schema）。其余文件与上游逐字相同。

代码沿用上游的 [PolyForm Noncommercial License 1.0.0](LICENSE.md)，并在 [NOTICE](NOTICE)
中保留 Required Notice。地图数据来自 OpenStreetMap（ODbL 1.0）。

## 目录

```
api/healthz.js                /api/healthz
api/v1/places.js              /api/v1/places
api/v1/routes.js              /api/v1/routes
api/v1/route-options.js       /api/v1/route-options
api/v1/map/cities.js          /api/v1/map/cities
api/v1/map/tiles.js           /api/v1/map/tiles?z=&x=&y=
api/ping.js                   平台存活探针，不 import 任何业务代码
api/diag.js                   逐个 import 模块，定位线上加载失败
lib/vercel-handler.js         适配器：把 Function 请求喂给同一个网关实例
lib/vercel-app.js             按环境变量组装 provider / 地图源 / 限流身份
lib/memory-storage.js         内存瓦片缓存（与磁盘、R2 相同的异步存储契约）
src/gateway.js                路由、校验、限流、错误码
src/amap-*.js                 高德调用与协议转换
src/map-tiles.js              PMTiles → 矢量瓦片 → GCJ-02 道路/建筑
shared/protocol/*.schema.json 请求 / 路线 / 候选路线的协议 schema（tests 校验）
dev-server.js                 本地预演（不需要 Vercel 账号）
vercel.json                   区域、时长、瓦片 rewrite、固件缓存头
public/firmware/              OTA 镜像与 latest.json（Vercel 静态托管）
scripts/publish_firmware.mjs  发布固件：拷镜像、算 SHA-256、写清单，--check 校验
```

Key、用户搜索和路线响应都不会落盘；瓦片只存在于温实例内存里，随实例销毁。

`public/` 是这个域名的首页：一件纯 canvas 的生成版画（`plate.js` + `plate.css`），
不用字体文件、不发任何请求。两枚雕刻罗盘反向旋转，指针会改变它们咬合的深度，
域名本身决定齿数（`www.` 会被去掉，所以 apex 与 www 是同一版）。深浅两套外观跟随系统，
`prefers-reduced-motion` 下停转、只在指针变化时重绘。首页与网关互不依赖：
函数全挂的时候它照样能显示（前提是部署本身没坏）。

`public/firmware/` 同时也是 ESP32 的 OTA 托管目录，见下文「固件 OTA 托管」。

## 本地运行

```sh
npm ci
npm run dev            # 需要 .env；没有就先 cp .env.example .env
```

不带 Key 也能验证整条链路：

```sh
MOTO_PROVIDER=fixture npm run dev
```

另一个终端：

```sh
curl --fail-with-body http://127.0.0.1:3000/api/healthz
curl --fail-with-body --get 'http://127.0.0.1:3000/api/v1/places' --data-urlencode 'keywords=济南西站'
curl --fail-with-body -H 'Content-Type: application/json' \
  --data-binary @fixtures/route-request-v1.json http://127.0.0.1:3000/api/v1/routes
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/v1/map/tiles/15/27044/12791
```

fixture 模式返回录制的高德响应、空搜索结果，并强制关闭周边地图：瓦片应返回
`503 MAP_DISABLED`。要连真实地图源（仍然不需要高德 Key）：

```sh
MOTO_PROVIDER=fixture MOTO_MAP_PMTILES_URL=auto npm run dev
```

`dev-server.js` 和 `vercel.json` 做同一条瓦片 rewrite，所以本地跑通就等于线上那条路也通。

`npm test` 不需要网络，也不需要 Key：fixture、假 fetch 和假 R2 覆盖了协议校验、限流、
缓存与上游故障路径。

## 线上

| | |
| --- | --- |
| 首页 | `https://www.doupaw.site/`（纯 canvas 作品，见上） |
| 网关根地址 | `https://www.doupaw.site/api/` |
| apex | `https://doupaw.site` → 308 → `https://www.doupaw.site` |
| 区域 | `hkg1`，函数与骑手同区 |
| 证书 | Let's Encrypt，Vercel 自动续期；HSTS 已开 |
| 固件 | `https://doupaw.site/firmware/moto-gps.bin` + `latest.json`（见下） |

实测（2026-10-26）：`/healthz` 200 `provider=amap`/`ready=true`；`/v1/places` 200 真实地点；
`/v1/routes`、`/v1/route-options` 200；`/v1/map/cities` 200 有效 `bounds_wgs84`；
`/v1/map/tiles/15/27044/12791` 200（104 条路 / 145 栋楼，`rev 20261026`）。
瓦片冷启动 1.7–6.9 s、同实例内命中内存缓存后为毫秒级——不同实例之间不共享缓存。

## 部署到 Vercel

### 控制台

1. **Add New → Project**，选本仓库。
2. **Root Directory 保持默认（仓库根）**。本仓库就是 Vercel 项目根，不要再填 `backend`。
3. **Framework Preset 选 Other**，Build Command 与 Output Directory 都留空。
4. Environment Variables（Production 与 Preview 都要）：
   - `MOTO_PROVIDER=amap`
   - `AMAP_WEB_SERVICE_KEY=<高德 Web 服务 Key>`
   可选：`MOTO_MAP_PMTILES_URL`、`WEB_ORIGIN`、`MOTO_MAP_CACHE_TILES`、
   `MOTO_MAP_CACHE_MAX_BYTES`，见 [`.env.example`](.env.example)。
5. Deploy。

### 命令行

```sh
npx vercel link
npx vercel env add AMAP_WEB_SERVICE_KEY production
npx vercel --prod
```

Key 必须是高德开放平台的 **「Web 服务」类型 Key**（POI 搜索 + 驾车路线 + 行政区划），
不是 iOS SDK Key，也不是网页 JS Key。Key 只放在服务端环境变量里，
不要写进仓库、Issue 或截图。

`MOTO_PROVIDER` 留空时：有 Key 按 `amap` 运行，没 Key 就是 `disabled`。
`/healthz` 的 `provider` 字段始终报告最终生效的模式，不会悄悄降级成演示路线。

## 验收（`/healthz` 不算数）

`/healthz` 只报告配置意图，不请求高德和地图源。以下每一条都要真的跑：

```sh
BASE=https://YOUR-DOMAIN/api

curl --fail-with-body $BASE/healthz
curl --fail-with-body --get $BASE/v1/places --data-urlencode 'keywords=济南西站'
curl --fail-with-body -H 'Content-Type: application/json' \
  --data-binary @fixtures/route-request-v1.json $BASE/v1/routes
curl --fail-with-body -H 'Content-Type: application/json' \
  --data-binary @fixtures/route-request-v1.json $BASE/v1/route-options
curl --fail-with-body --get $BASE/v1/map/cities --data-urlencode 'keywords=历下区'
curl --fail-with-body -o /tmp/tile.json -w 'HTTP %{http_code}\n' $BASE/v1/map/tiles/15/27044/12791
```

期望：

- `healthz`：`provider: amap`、`ready_for_live_navigation: true`、
  `capabilities.surrounding_map: true`、`map_source.cache.storage: "memory"`。
- 搜索返回真实地点；两个路线接口返回 `routes` / `route`；城市返回有效 `bounds_wgs84`。
- 瓦片 200 且含 `roads` / `buildings`；再次请求同一瓦片应命中内存缓存
  （`map_source.cache.tiles` 不再增长，`last_success_at` 非空）。

| 现象 | 先查 |
| --- | --- |
| 瓦片 404 | `vercel.json` 的 rewrite 是否随本次部署生效；函数名是否仍是 `api/v1/map/tiles.js` |
| 瓦片 503 `MAP_DISABLED` | `MOTO_PROVIDER` 不是 `amap`，且没显式设 `MOTO_MAP_PMTILES_URL` |
| 瓦片 503 `MAP_UPSTREAM_*` | 出网到 `build.protomaps.com` / 清单域名；换固定 `.pmtiles` 地址复测 |
| 搜索 503 `AMAP_*` | Key 类型、权限、配额、出口 IP 白名单 |
| 全部 503 `SERVER_MISCONFIGURED` | 环境变量没进 Production，或改完没重新部署 |
| **所有路径（含 `/`）都 500 `FUNCTION_INVOCATION_FAILED`** | 先看 **Project Settings → Framework Preset 是不是 `Other`**。设成 Node 时 Vercel 会把 `src/server.js` 当根入口包成**一个**函数，所有路径都打到它，而它只会 `listen(127.0.0.1)`，于是全 500。用 API 纠正：`PATCH /v9/projects/{id}` body `{"framework": null}` |
| POST 400 `INVALID_JSON` | 函数没收到请求体；用上面的 `--data-binary` 复测 |

### 如果 /api/healthz 直接返回 FUNCTION_INVOCATION_FAILED

这是 Vercel 的兜底错误页，不带任何信息。按顺序打这两个探针，把输出贴出来即可定位：

```sh
curl -sS $BASE/ping     # 只证明运行时和 ESM 默认导出可用
curl -sS $BASE/diag     # 逐个 import，坏在哪个模块会自己报名
```

`diag` 只回显 Node 版本、区域、环境变量**是否存在**（不返回值）和每个模块的加载结果，
方便一眼区分「模块加载崩」和「处理请求时崩」。更细的堆栈在
Vercel 项目 → Deployments → 该部署 → **Logs**（适配器出错时会 `console.error` 打完整堆栈）。

部署稳定后这两个文件可以直接删掉，不影响网关。

## 域名与 HTTPS

Vercel 项目 → **Settings → Domains** → 添加 `doupaw.site` 与 `www.doupaw.site`。
面板会给出该项目的记录值（当前文档示例是 `CNAME cname.vercel-dns-0.com`，**以自己面板为准**），
按提示在 DNS 服务商处加 `A @` 和 `CNAME www`。证书自动签发（Let's Encrypt，自动续期，
不需要 certbot），随后开启 www → apex 重定向和强制 HTTPS。

若把 NS 交给 Vercel（`ns1.vercel-dns.com` / `ns2.vercel-dns.com`），记录全部在 Vercel 里维护，
一次到位，但原有 MX / TXT 要先迁过去。

```sh
curl -sSI https://doupaw.site/api/healthz | head -3    # 200，且不跳回 http
```

## 固件 OTA 托管

`public/` 是 Vercel 的静态站点根目录，所以 OTA 镜像和清单不需要再写一个 Function：

```text
https://doupaw.site/firmware/moto-gps.bin   ESP32 app 镜像
https://doupaw.site/firmware/latest.json   版本、URL、SHA-256、字节数
```

发布（镜像由 `moto-gps` 主仓库构建，然后拷进本仓库）：

```sh
node scripts/publish_firmware.mjs --bin=../moto/platforms/esp32/build/moto_gps_esp32.bin
node scripts/publish_firmware.mjs --check
npx vercel --prod
```

脚本只接受 1 MiB–7 MiB 的镜像（与 OTA 分区一致），计算 SHA-256，并把同一个
`moto-gps.bin` 与 `latest.json` 写进 `public/firmware/`。清单缓存 60 秒，镜像同样
60 秒后重新验证，避免刚发布时长期命中旧文件。`--check` 在 CI 或发布前确认清单
没有落后于镜像（`npm test` 里的 `test/firmware-release.test.js` 也会比对两者）。

验收：

```sh
curl -sS https://doupaw.site/firmware/latest.json
curl -sSI https://doupaw.site/firmware/moto-gps.bin   # 200 + application/octet-stream
```

App 的 05 固件 →「获取 doupaw.site 最新固件」会读取这个清单并填入下载地址与摘要；
圆屏通过手机热点用 HTTPS 下载，校验 SHA-256 后才切换启动分区。

## 客户端如何指向

- 已安装的 App：首页 →「网关设置」填 `https://doupaw.site/api/`，保存即生效，不用重编。
- 源码构建：改 `platforms/ios/project.yml` 的 `MOTOGPSGatewayBaseURL`，
  注意**末尾多一层 `/api/`**（Node 与 Workers 宿主是自定义路径）。
- ESP32 固件不需要改。

## 已知限制

- **没有共享缓存**：瓦片只在温实例内存里（默认 300 张），冷实例要重新向 PMTiles 源取字节。
  骑行时同一实例基本都在服务，第一张慢、之后快；换区域或冷启动会再慢一次。
- **限流只在实例内有效**：并发扩容后每个实例各算各的，能挡误用和刷新循环，
  不能当成对公网 Key 的保护。真要防刷需要 Upstash Redis 之类的共享计数，本版没有做。
- **单一区域**：Vercel Hobby 只能一个 region，`vercel.json` 里填了 `hkg1`（香港）。
- **冷启动**：首个请求要读 Protomaps 构建清单（实测 0.3–6 s 视网络），此后实例复用不再重复。
- **无定时任务**：地图源版本在冷启动时更新，可能比官方构建晚一天。
- **大陆访问**：Vercel 不在中国大陆境内、无 ICP 备案节点，跨境延迟和丢包都存在。
- **Hobby 仅限个人非商业用途**；并发、时长、带宽上限以 Vercel 计划页为准。

## 回滚

客户端把「网关设置」改回原地址即可；本仓库的服务端与 Node / Workers 两套宿主可以并存。
