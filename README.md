# koishi-plugin-mydaddy

[![npm](https://img.shields.io/npm/v/koishi-plugin-mydaddy?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mydaddy)

一个基于 Koishi 的娱乐插件，用于生成热爱游戏、把游戏公司当父亲“尽孝”风格的游戏深度评论文章。

💖 **本插件核心 Prompt 逻辑完全移植自 AstrBot 插件：[astrbot_plugin_wwkudie](https://github.com/NumInvis/astrbot_plugin_wwkudie) (作者: NumInvis)**  
已根据原作者开源协议进行移植并在 Koishi 生态中用现代化 TypeScript 和大语言模型聚合架构二次开发。

## 简介

当你想对某个游戏公司的某个事件发表极度偏向、情感强烈的小作文时，这个插件可以通过接入 ChatLuna 的大模型（LLM）一键为你生成。

## 配置与依赖

本插件**强制依赖 `koishi-plugin-chatluna` 服务**。
这意味着你不需要为这个插件单独配置 API 密钥或地址，只要你的 Koishi 控制台中正确配置了任何 ChatLuna 模型（例如 OpenAI、Anthropic、DeepSeek 等），就可以直接给这个插件使用！

### 配置项
在 Koishi 管理后台插件配置页，你需要填写：
* **model**: 在下拉列表中选择一个 ChatLuna 中已经加载的可用模型（必须）。
* **retryTimes**: 生成失败后的重试次数，默认 `2`（0-5）。Gemini 系列模型偶尔返回 `MALFORMED_FUNCTION_CALL`，这类失败通常是偶发的，重试即可成功。
* **systemPrompt**: 写作人格设定（默认已配置好“尽孝”风格，通常不需要修改）。

## 基本用法

```
尽孝 游戏名 事件描述
```

### 示例
```
尽孝 鸣潮 有人黑角色西格莉卡绑男角色仇远所以不抽西格莉卡
尽孝 原神 3.0版本须弥开放
尽孝 王者荣耀 新英雄上线
```

## 常见问题

**报错 `ChatLuna error getting response` / `Gemini generation failed: MALFORMED_FUNCTION_CALL`**

这是 Gemini 服务端返回的失败原因（finish reason 不是 STOP），与插件无关，但插件现在会自动重试 `retryTimes` 次。若重试后仍失败，可在 ChatLuna 中换用其他平台的模型，或调低要求的字数再试。

## 许可证

MIT License
