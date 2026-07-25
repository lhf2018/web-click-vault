# web-click-vault

把每次有效网页浏览折算成一笔本地「资产」入账的 Chrome 扩展。  
数据只保存在本机，不做正文分析，不上传浏览历史。

## 功能概览

- **动态入账**：按停留、加载、新鲜度、页面类型加权，单次 ≤ ¥10
- **自动结算**：关闭标签或跳转离开后入账
- **周视图**：近 7 日入账曲线
- **会话防丢**：异常关闭后可在 Popup 补结算
- **SPA 策略**：默认忽略 History 路由（设置里可开）
- **公式可观测**：设置页可查看最近一笔得分拆解

## 仓库结构

```text
.
├── extension/                      # 可直接加载的 Chrome 扩展
│   ├── manifest.json
│   ├── background/                 # Service Worker
│   ├── content/dwell-probe.js      # 可见性停留探针
│   ├── core/                       # 公式 / 指标 / 账本
│   ├── popup/                      # 弹窗账本
│   └── options/                    # 设置页
├── internet-odometer-prd.html      # 产品 PRD
└── internet-asset-meter-tech.html  # 技术方案
```

## 安装（加载已解压的扩展）

1. 打开 Chrome：`chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库里的 `extension` 目录：

```text
web-click-vault/extension
```

5. 首次加载会请求访问网页权限（用于停留计时探针）

修改代码后，在扩展管理页点击 **重新加载**。

## 使用

1. 正常浏览 `http/https` 网页
2. 关闭标签或跳到其他网站后自动入账
3. 点击工具栏图标查看今日入账、至今访问页数、周曲线与最近一笔
4. 在设置页调整 SPA 计数、查看公式拆解或重置数据

## 入账公式

```text
deposit = clamp(round(10 × Score × (1 + Noise), 2), 0.30, 10)

Score = 0.45·停留 + 0.20·加载 + 0.20·新鲜度 + 0.15·页面类型
Noise ~ Uniform(-0.08, +0.08)
```

同一 URL 在约 90 秒内去重，避免短时重复打开虚增。

## 隐私

- 使用 `chrome.storage.local`，默认不离开浏览器
- 只统计有效 http(s) 打开；排除浏览器内部页与扩展页
- 停留按页面可见性累计，后台标签不计时
- 不读取页面正文，不上传流水

## 文档

本地打开即可阅读：

- [产品 PRD](./internet-odometer-prd.html)
- [技术方案](./internet-asset-meter-tech.html)

## License

MIT
