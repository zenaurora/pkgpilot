import { describe, expect, test } from 'bun:test'
import { extractQuickstart, htmlToMarkdownish, parseFencedBlocks, rstToMarkdownish } from '../src/core/docs.ts'

describe('parseFencedBlocks', () => {
  test('解析围栏代码块并记录所属标题', () => {
    const md = ['# Intro', '', '## Usage', '', '```rust', 'fn main() {}', '```', '', '## Other', '```', 'plain', '```'].join('\n')
    const blocks = parseFencedBlocks(md)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ lang: 'rust', code: 'fn main() {}', heading: 'Usage' })
    expect(blocks[1]).toEqual({ lang: '', code: 'plain', heading: 'Other' })
  })

  test('支持 ~~~ 围栏与未闭合块丢弃', () => {
    const md = ['~~~py', 'print(1)', '~~~', '```js', 'never closed'].join('\n')
    const blocks = parseFencedBlocks(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lang).toBe('py')
  })
})

describe('extractQuickstart', () => {
  test('优先选 Usage 标题下的目标语言代码块', () => {
    const md = [
      '## Install',
      '```sh',
      'cargo add serde',
      '```',
      '## Usage',
      '```rust',
      'let s = serde_json::to_string(&x)?;',
      '```',
      '## Benchmarks',
      '```rust',
      'bench();',
      '```',
    ].join('\n')
    expect(extractQuickstart(md, 'rust')).toBe('let s = serde_json::to_string(&x)?;')
  })

  test('纯安装命令块被跳过', () => {
    const md = ['```', '$ npm install lodash', 'pip install requests', '```'].join('\n')
    expect(extractQuickstart(md, 'js')).toBeUndefined()
  })

  test('只有配置类语言块（toml/sh）时返回 undefined', () => {
    const md = ['```toml', '[dependencies]', 'serde = "1"', '```'].join('\n')
    expect(extractQuickstart(md, 'rust')).toBeUndefined()
  })

  test('没有语言标注的块可作为兜底', () => {
    const md = ['```', 'import requests', 'requests.get(url)', '```'].join('\n')
    expect(extractQuickstart(md, 'python')).toBe('import requests\nrequests.get(url)')
  })

  test('超长代码截断到 24 行并加省略号', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`)
    const md = ['```python', ...body, '```'].join('\n')
    const out = extractQuickstart(md, 'python')!
    const lines = out.split('\n')
    expect(lines).toHaveLength(25)
    expect(lines[24]).toBe('…')
  })

  test('同分时取更靠前的块', () => {
    const md = ['## Usage', '```js', 'first()', '```', '```js', 'second()', '```'].join('\n')
    // 第二个块也在 Usage 标题下，但第一个先出现
    expect(extractQuickstart(md, 'js')).toBe('first()')
  })
})

describe('htmlToMarkdownish', () => {
  test('pre/code 转围栏块，保留 language-*，实体解码', () => {
    const html = '<h2>Usage</h2><pre><code class="language-rust">let v: Vec&lt;String&gt; = vec![];</code></pre>'
    const md = htmlToMarkdownish(html)
    expect(md).toContain('## Usage')
    expect(md).toContain('```rust\nlet v: Vec<String> = vec![];\n```')
  })

  test('无 code 标签的 pre 也能转换，其余标签被剥掉', () => {
    const html = '<p>hello <b>world</b></p><pre>plain code</pre>'
    const md = htmlToMarkdownish(html)
    expect(md).toContain('```\nplain code\n```')
    expect(md).toContain('hello')
    expect(md).not.toContain('<b>')
  })
})

describe('rstToMarkdownish', () => {
  test('code-block 指令转围栏块并去缩进', () => {
    const rst = ['Usage', '=====', '', '.. code-block:: python', '', '    import foo', '    foo.run()', '', 'after'].join('\n')
    const md = rstToMarkdownish(rst)
    expect(md).toContain('## Usage')
    expect(md).toContain('```python\nimport foo\nfoo.run()\n```')
    expect(md).toContain('after')
  })

  test('带选项行的指令跳过选项', () => {
    const rst = ['.. code-block:: python', '   :linenos:', '', '   x = 1'].join('\n')
    expect(rstToMarkdownish(rst)).toContain('```python\nx = 1\n```')
  })

  test('与 extractQuickstart 串起来能提取 rst 用法', () => {
    const rst = ['Install', '=======', '', '.. code-block:: console', '', '   pip install foo', '', 'Usage', '=====', '', '.. code-block:: python', '', '   foo.go()'].join('\n')
    expect(extractQuickstart(rstToMarkdownish(rst), 'python')).toBe('foo.go()')
  })
})
