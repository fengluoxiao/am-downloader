# 1Panel 创建 wrapper-lite 与桌面程序连接流程

## 1. 下载仓库并构建镜像

在安装了 1Panel 的 **Linux x86_64 服务器**打开「主机 → 终端」（也可使用 SSH），执行：

```bash
cd /opt
git clone https://ghclone.com/WorldObservationLog/wrapper.git wrapper
cd /opt/wrapper
mkdir -p rootfs/data
docker build -t wrapper-lite:local .
```

如果 `/opt/wrapper` 已经是旧服务目录，先备份并改用新目录，例如 `/opt/wrapper-lite`，同时修改后面的挂载路径。不要覆盖正在使用的旧账号数据。上游 Dockerfile 默认使用 amd64，ARM 服务器不能直接照搬此构建方式。

构建成功后，在「容器 → 镜像」中应能找到 `wrapper-lite:local`。Git 加速地址只加速仓库下载；构建时 Debian、LLVM、Android NDK 等依赖仍使用 Dockerfile 中的下载地址。

## 2. 在 1Panel 创建编排

进入「容器 → 编排」，点击「创建编排」（部分版本显示「创建」），名称填写 `wrapper-lite`，选择手动输入 Compose 内容，粘贴：

```yaml
services:
  wrapper-lite:
    image: wrapper-lite:local
    container_name: wrapper-lite
    privileged: true
    restart: unless-stopped
    ports:
      - "12340:12340"
    volumes:
      - /opt/wrapper/rootfs/data:/app/rootfs/data
    environment:
      USERNAME: 'your-apple-id'
      PASSWORD: 'your-password'
```

将 `your-apple-id`、`your-password` 替换成有 Apple Music 订阅的账号及密码。Compose 中密码的 `$` 写成 `$$`，单引号写成两个单引号 `''`。例如实际密码 `a$b'c` 应写为 `'a$$b''c'`。

点击确认/部署。该编排直接使用第一步构建的本机镜像。容器名称若已被占用，先在 1Panel 确认对应旧容器并停止、改名，再创建编排；不要删除账号数据目录。

## 3. 首次登录与双重认证

进入「容器 → wrapper-lite → 日志」，首次启动会执行账号登录。如果日志出现 `Enter your 2FA code`，在服务器终端执行，将 `123456` 换成设备收到的六位验证码：

```bash
printf '%s' '123456' > /opt/wrapper/rootfs/data/2fa.txt
```

也可以在 1Panel 的「文件」页面创建 `/opt/wrapper/rootfs/data/2fa.txt`，内容只写六位验证码。必须在提示后约 60 秒内提交；超时后重新启动容器，并使用新收到的验证码。

验证码文件位于挂载目录根部，**不是**旧 wrapper 的 `data/com.apple.android.music/files/2fa.txt`。程序读取后会自动删除该文件。

看到 `login complete, exiting` 后入口脚本会接着启动 HTTP 服务。验证：

```bash
curl --fail http://127.0.0.1:12340/status
```

正常响应类似：

```json
{"code":0,"msg":"SUCCESS","data":{"regions":["cn"]}}
```

`regions` 非空表示服务返回了已登录账号的区域；它不能代替实际歌曲下载验证。账号数据库、token 和设备标识均保存在 `/opt/wrapper/rootfs/data`，重建容器时保留此目录。已有缓存时入口脚本会跳过登录；更换账号请停止容器、备份旧数据，再使用独立的新数据目录重新登录。

## 4. 让桌面程序访问服务器

如果桌面程序运行在另一台电脑，确认电脑可以访问服务器的 TCP `12340`。若使用了服务器防火墙、云安全组或 1Panel 防火墙，为该电脑的 IP 放行此端口。HTTP 服务自身不提供访问认证，适合通过局域网、VPN 或 SSH 隧道访问。

桌面程序打开「解密服务」：

1. 连接方式选择「远程服务 / 1Panel」。
2. 地址填写 `http://服务器IP:12340`，例如 `http://192.168.1.10:12340`。
3. 点击「保存并检查连接」，确认显示账号区域和「服务已就绪」。
4. 检查本机下载器及 MP4Box，然后搜索歌曲或粘贴链接开始下载。

在「设置」中将 `storefront` 设为服务账号的区域，例如 `cn`、`us` 或 `jp`，与页面显示的账号区域一致。

服务器地址必须从桌面程序所在电脑可达；电脑上的 `127.0.0.1` 指的是电脑自身。若已通过 SSH 将服务转发到电脑的 12340 端口，仍选择「远程服务 / 1Panel」，地址填写 `http://127.0.0.1:12340`。

对应 `config.yaml`：

```yaml
wrapper-mode: remote
wrapper-lite-url: "http://192.168.1.10:12340"
temari-lib: ""
```

远程模式下，容器启停、Apple ID 登录和账号切换都由 1Panel 管理。桌面程序不需要安装 Docker，音乐下载到电脑的配置目录。普通歌曲的歌词、AAC-LC 和 MV 直接使用 wrapper-lite 账号；`station-token` 仅用于电台。

## 5. 使用本机 Docker（可选）

在电脑上准备 `wrapper-lite:local` 镜像后，连接方式选「本机 Docker」，地址使用 `http://127.0.0.1:12340`。程序管理名称为 `wrapper-lite` 的容器，数据目录默认 `~/tools/wrapper-lite/rootfs/data`，可通过 `AM_WRAPPER_DIR` 改变根目录。该模式的账号槽位保存在应用数据目录的 `wrapper-lite-accounts`，首次使用需要重新登录。

旧 `apple-music-wrapper` 的 TCP 端口和账号槽位不再用于新服务。应用首次迁移配置时将原配置备份为 `config.yaml.pre-wrapper-lite.bak`，保留下载路径与质量设置。

## 常见问题

- **找不到镜像**：第一步须在运行 1Panel 的同一台服务器执行；在「镜像」页面检查标签是否正好为 `wrapper-lite:local`。
- **构建提示 wget: not found**：上游 Dockerfile 使用 wget 下载 LLVM 脚本；在其 apt 安装列表补上 `wget ca-certificates` 再构建。
- **连接失败**：先在服务器测试 `/status`，再从电脑测试相同路径，依次检查日志、地址和端口放行。
- **服务已连接但未登录**：检查容器日志、账号订阅与验证码，不要通过复制旧 TCP wrapper 数据跳过首次登录。
- **Temari 加载失败**：保持 `temari-lib: ""` 使用随新下载器打包的库；自定义库路径必须属于运行桌面程序的电脑。
- **只有某首歌失败**：保留下载日志并检查账号区域、订阅和歌曲可用性；HTTP 状态正常并不保证所有歌曲均可下载。

### 获取密钥失败时开启详细日志

在现有编排的 `wrapper-lite` 服务下添加以下内容，与 `image` 同级，保留已有挂载与账号配置：

```yaml
    command: ["/app/entrypoint.sh", "--log-level", "debug"]
```

镜像使用 `CMD ["/app/entrypoint.sh"]` 启动，没有设置 `ENTRYPOINT`。Compose 的 `command` 会替换整个 CMD，因此必须包含脚本路径。仅写 `["--log-level", "debug"]` 会导致容器启动报 `exec: "--log-level": executable file not found`。

保存并重新部署后，重试失败歌曲，再在服务器查看日志：

```bash
docker logs --since 5m wrapper-lite 2>&1 | grep -v 'request: GET /status' | tail -200
```

分享日志时隐藏账号、密码和 token。排查完成后删除上述 `command` 配置并重新部署，即恢复默认日志级别。
