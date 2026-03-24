import { Context, Schema, Logger } from 'koishi'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { ComputedRef } from 'koishi-plugin-chatluna'

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
}

export const Config = Schema.intersect([
    Schema.object({
        model: Schema.dynamic('model').description('使用的的大语言模型名称 (需要通过 ChatLuna 先配置好)'),
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

export function apply(ctx: Context, config: Config) {
    let model: ComputedRef<ChatLunaChatModel>

    const loadModel = async () => {
        model = await ctx.chatluna.createChatModel(config.model)
    }

    modelSchema(ctx)
    ctx.on('ready', async () => {
        loadModel()
    })

    ctx.command('mydaddy <game:string> <event:text>', '生成尽孝长文')
        .alias('尽孝')
        .action(async ({ session }, game, event) => {
            if (!game || !event) {
                return '请提供游戏名和事件描述！\n使用方式：尽孝 游戏名 事件描述'
            }

            if (!model || !model.value) {
                return '错误：无法获取语言模型。请检查你的 ChatLuna 模型配置或等待服务加载完毕。'
            }

            const promptUserMessage = `游戏：${game}\n事件：${event}\n\n请根据上述游戏和事件，撰写一篇符合风格要求的深度评论文章。`

            try {
                await session?.send('🖊️ 正在请求 ChatLuna 处理...')

                const result = await model.value.invoke([
                    new SystemMessage(config.systemPrompt),
                    new HumanMessage(promptUserMessage)
                ])

                if (result && result.content) {
                    // content 可以是 string 或者 MessageContentComplex[]，简单起见我们优先当做字符串处理或转型
                    return typeof result.content === 'string'
                        ? result.content
                        : JSON.stringify(result.content)
                } else {
                    return '生成失败：模型未返回任何内容。'
                }

            } catch (e: any) {
                logger.error(`尽孝生成失败:`, e)
                return `错误：请求模型服务失败。${e.message || e}`
            }
        })
}
