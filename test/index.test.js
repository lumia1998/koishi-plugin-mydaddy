const assert = require('node:assert')
const { apply, extractText, describeError } = require('../lib/index.js')

/**
 * 构造一个假的 Koishi ctx：捕获注册的命令 action，并支持触发 ready 事件
 * （老版本插件依赖 ctx.on('ready') 初始化模型）。
 */
function createCtx({ createChatModel }) {
    const captured = {}
    const handlers = {}

    const ctx = {
        chatluna: {
            createChatModel,
            platform: { listAllModels: () => ({ value: [] }), listModelNames: () => ({ value: [] }) }
        },
        schema: { set() {}, add() {}, remove() {}, get() {} },
        effect() {},
        on(event, callback) {
            ;(handlers[event] ||= []).push(callback)
        },
        command(name) {
            captured.command = name
            const chain = {
                alias(alias) {
                    captured.alias = alias
                    return chain
                },
                action(handler) {
                    captured.handler = handler
                    return chain
                }
            }
            return chain
        }
    }

    const flush = async () => {
        for (const callback of handlers.ready || []) await callback()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }

    return { ctx, captured, flush }
}

/** 按顺序返回预设结果的假模型 */
function createModel(behaviours) {
    const calls = []
    return {
        calls,
        invoke: async (messages) => {
            calls.push(messages)
            const next = behaviours.shift()
            if (!next) throw new Error('unexpected extra invoke() call')
            if (next.error) throw next.error
            return { content: next.content }
        }
    }
}

const config = {
    model: 'gemini/gemini-3-flash',
    systemPrompt: '系统提示词',
    retryTimes: 1
}

const malformed = () =>
    Object.assign(new Error('Gemini generation failed: MALFORMED_FUNCTION_CALL'), {
        errorCode: 163
    })

/** 装载插件，并让 Koishi 生命周期的 ready 事件走完 */
async function setup(behaviours) {
    const model = createModel(behaviours)
    const env = createCtx({ createChatModel: async () => ({ value: model }) })
    apply(env.ctx, config)
    await env.flush()
    return { ...env, model }
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('正常生成：返回模型文本，消息以 message-like 元组传入', async () => {
    const { captured, model } = await setup([{ content: '  一篇尽孝长文  ' }])

    assert.strictEqual(captured.command, 'mydaddy <game:string> <event:text>')
    assert.strictEqual(captured.alias, '尽孝')

    const result = await captured.handler(
        { session: { send: async () => {} } },
        '鸣潮',
        '送自选五星'
    )

    assert.strictEqual(result, '一篇尽孝长文')
    assert.strictEqual(model.calls.length, 1)
    assert.deepStrictEqual(model.calls[0][0], ['system', '系统提示词'])
    assert.strictEqual(model.calls[0][1][0], 'human')
    assert.ok(model.calls[0][1][1].includes('鸣潮'))
})

test('模型懒加载：插件加载时不调用 createChatModel（配置热重载也能用）', async () => {
    let created = 0
    const model = createModel([{ content: 'ok' }])
    const { ctx, captured, flush } = createCtx({
        createChatModel: async () => {
            created++
            return { value: model }
        }
    })
    apply(ctx, config)
    assert.strictEqual(created, 0, 'apply() 阶段不应解析模型')

    await flush()
    assert.strictEqual(created, 0, 'ready 事件也不应预先解析模型')

    await captured.handler({}, '原神', '须弥开放')
    assert.strictEqual(created, 1)
})

test('回归：MALFORMED_FUNCTION_CALL 后重试成功（issue #1）', async () => {
    const { captured, model } = await setup([{ error: malformed() }, { content: '重试后生成的正文' }])

    const result = await captured.handler({}, '王者荣耀', '新英雄上线')

    assert.strictEqual(result, '重试后生成的正文', '重试后应返回正文而不是错误')
    assert.strictEqual(model.calls.length, 2, '应重试一次')
})

test('重试耗尽：给出可读的错误提示', async () => {
    const { captured, model } = await setup([{ error: malformed() }, { error: malformed() }])

    const result = await captured.handler({}, '原神', '测试')

    assert.ok(result.startsWith('错误：请求模型服务失败（已尝试 2 次）。'), result)
    assert.ok(result.includes('MALFORMED_FUNCTION_CALL'), result)
    assert.strictEqual(model.calls.length, 2, 'retryTimes=1 时最多请求 2 次')
})

test('空响应也算失败并重试', async () => {
    const { captured } = await setup([{ content: '   ' }, { content: '第二次拿到内容' }])

    const result = await captured.handler({}, '原神', '测试')
    assert.strictEqual(result, '第二次拿到内容')
})

test('模型不可用：返回明确提示而不是抛异常', async () => {
    const { ctx, captured, flush } = createCtx({ createChatModel: async () => ({ value: undefined }) })
    apply(ctx, config)
    await flush()

    const result = await captured.handler({}, '原神', '测试')
    assert.ok(result.includes('无法获取模型'), result)
})

test('缺少参数时的用法提示', async () => {
    const { captured } = await setup([])
    const result = await captured.handler({}, '原神', '')
    assert.ok(result.includes('请提供游戏名和事件描述'), result)
})

test('extractText 兼容 string 与多段 content', () => {
    assert.strictEqual(extractText({ content: ' abc ' }), 'abc')
    assert.strictEqual(
        extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
        'ab'
    )
    assert.strictEqual(extractText({}), '')
})

test('describeError 覆盖常见失败', () => {
    assert.ok(describeError(malformed()).includes('MALFORMED_FUNCTION_CALL'))
    assert.ok(describeError(new Error('MODEL_NOT_FOUND')).includes('模型不存在'))
    assert.strictEqual(describeError(new Error('boom')), 'boom')
})

;(async () => {
    let failed = 0
    for (const { name, fn } of tests) {
        try {
            await fn()
            console.log(`ok   - ${name}`)
        } catch (error) {
            failed++
            console.log(`FAIL - ${name}`)
            console.log(`       ${error.message.split('\n').join('\n       ')}`)
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`)
    process.exit(failed === 0 ? 0 : 1)
})()
