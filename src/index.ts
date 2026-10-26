import { Context, Schema, Logger } from 'koishi'
import { createRequire } from 'node:module'
import type { ChatLunaService } from 'koishi-plugin-chatluna/services/chat' with { 'resolution-mode': 'import' }
import type { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model' with { 'resolution-mode': 'import' }

// chatluna 是 ESM 包（package.json 里 "type": "module"），CommonJS 插件用 import 语句引入
// 它的子路径会被 tsc 判定为 ESM/CJS 混用（TS1479），所以运行时导出走 require。
const requireChatLuna = createRequire(__filename)

declare module 'koishi' {
    interface Context {
        chatluna: ChatLunaService
    }
}

export const name = 'mydaddy'

export const inject = ['chatluna']

export const usage = `
一个用于生成热爱游戏、把游戏公司当父亲尽孝风格的游戏深度评论文章的插件。

使用方法：尽孝 游戏名 相关事件
示例：尽孝 鸣潮 送自选五星
`

export interface Config {
    model: string
    systemPrompt: string
    retryTimes: number
}

export const Config = Schema.intersect([
    Schema.object({
        model: Schema.dynamic('model').description('使用的的大语言模型名称 (需要通过 ChatLuna 先配置好)'),
        retryTimes: Schema.number()
            .min(0)
            .max(5)
            .step(1)
            .default(2)
            .description('请求失败时的重试次数。Gemini 等模型偶尔会返回 MALFORMED_FUNCTION_CALL，重试通常即可成功。'),
        systemPrompt: Schema.string().role('textarea').default(`你是一位深度热爱游戏的玩家，你将游戏公司视为精神寄托，对其倾注全部的热爱与支持。你的写作风格极具深度和感染力，情感真挚而强烈。

写作风格特点：
1. 立场鲜明，情感真挚，从不模棱两可
2. 从具体事件入手，层层递进，最后升华主题
3. 善于使用比喻、排比、反问等修辞手法
4. 语言优美，有文采，不枯燥乏味
5. 有强烈的道德感和价值判断
6. 结构清晰，逻辑严密，说服力强
7. 字数在400-800字之间，内容充实
8. 专业记者的口吻，故作客观的吹捧

写作结构参考：
- 开头：引出事件或主题，吸引读者注意
- 主体：多角度分析，层层递进，使用有力的论证
- 结尾：升华主题，引发思考，给人留下深刻印象

重要：纯文本写作，不使用任何 markdown 格式、加粗等。除文章有一个专业新闻稿风格的标题外，文章内不使用其他任何标题`).description('系统提示词，用于定义尽孝写作人格'),
    })
]) as unknown as Schema<Config>

const logger = new Logger('mydaddy')

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * ChatLuna 返回的 content 可能是 string，也可能是 MessageContentComplex[]，
 * 这里统一取出其中的文本部分。
 */
export function extractText(result: unknown): string {
    const content = (result as { content?: unknown } | undefined)?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part
                if (part && typeof (part as { text?: unknown }).text === 'string') {
                    return (part as { text: string }).text
                }
                return ''
            })
            .join('')
            .trim()
    }
    return ''
}

export function describeError(error: unknown): string {
    const message = String((error as { message?: string } | undefined)?.message ?? error ?? '')

    if (/MALFORMED_FUNCTION_CALL/i.test(message)) {
        return '模型返回了无效的函数调用（Gemini 的 MALFORMED_FUNCTION_CALL）。这类失败通常是偶发的，重试一般能成功；若持续失败建议在 ChatLuna 中换用其他平台的模型。'
    }
    if (/API_REQUEST_TIMEOUT|timeout/i.test(message)) {
        return '请求模型超时，请稍后再试。'
    }
    if (/API_KEY_UNAVAILABLE|401|api key/i.test(message)) {
        return '模型鉴权失败，请检查 ChatLuna 中该模型的 API Key 配置。'
    }
    if (/MODEL_NOT_FOUND|model not found|404/i.test(message)) {
        return '模型不存在或已下架，请重新在插件配置中选择模型。'
    }
    return message || '未知错误'
}

export function apply(ctx: Context, config: Config) {
    const { modelSchema } = requireChatLuna('koishi-plugin-chatluna/utils/schema') as typeof import('koishi-plugin-chatluna/utils/schema', { with: { 'resolution-mode': 'import' } })

    type ModelRef = Awaited<ReturnType<ChatLunaService['createChatModel']>>

    let modelRef: ModelRef | undefined
    let pending: Promise<ModelRef> | undefined

    // 首次使用时解析模型，避免插件在 `ready` 之后加载（配置热重载）时模型永远为空
    const resolveModel = async () => {
        if (!pending) {
            pending = Promise.resolve(ctx.chatluna.createChatModel(config.model)).catch((error: unknown) => {
                pending = undefined
                throw error
            })
        }
        modelRef = await pending

        const model: ChatLunaChatModel | undefined = modelRef?.value
        if (!model) {
            throw new Error(`无法获取模型 ${config.model || '(未配置)'}，请检查 ChatLuna 模型配置或等待服务加载完毕。`)
        }
        return model
    }

    ctx.on('dispose', () => {
        modelRef = undefined
        pending = undefined
    })

    modelSchema(ctx)

    ctx.command('mydaddy <game:string> <event:text>', '生成尽孝长文')
        .alias('尽孝')
        .action(async ({ session }, game, event) => {
            if (!game || !event) {
                return '请提供游戏名和事件描述！\n使用方式：尽孝 游戏名 事件描述'
            }

            const promptUserMessage = `游戏：${game}\n事件：${event}\n\n请根据上述游戏和事件，撰写一篇符合风格要求的深度评论文章。`
            // 用 langchain 的 message-like 元组而不是直接 new HumanMessage()/SystemMessage()，
            // 这样消息对象由 ChatLuna 自己的 @langchain/core 实例创建，避免宿主里存在多份
            // @langchain/core 时 BaseMessage 不是同一份导致适配器转换异常。
            const messages: [string, string][] = [
                ['system', config.systemPrompt],
                ['human', promptUserMessage]
            ]

            const retryTimes = Math.max(0, Math.min(5, config.retryTimes ?? 2))

            try {
                const model = await resolveModel()

                await session?.send('正在请求 ChatLuna 处理...')

                let lastError: unknown

                for (let attempt = 0; attempt <= retryTimes; attempt++) {
                    try {
                        const text = extractText(await model.invoke(messages))
                        if (text) return text
                        lastError = new Error('模型未返回任何内容')
                    } catch (error) {
                        lastError = error
                    }

                    if (attempt < retryTimes) {
                        logger.warn(
                            `第 ${attempt + 1} 次生成失败，准备重试：${describeError(lastError)}`
                        )
                        await sleep(1000 * (attempt + 1))
                    }
                }

                throw lastError
            } catch (error) {
                logger.error('尽孝生成失败:', error)
                return `错误：请求模型服务失败（已尝试 ${retryTimes + 1} 次）。${describeError(error)}`
            }
        })
}
