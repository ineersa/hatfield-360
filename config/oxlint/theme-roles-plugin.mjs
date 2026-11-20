// Keeps renderer styling on the app theme's roles (src/renderer/src/assets/main.css): class names
// with raw colours, Tailwind text sizes or weights, stock radii or fixed row heights are reported.
const RADIUS_ROLES = new Set(['island', 'component', 'button', 'popup', 'banner', 'full', 'none'])

const CHECKS = [
  {
    pattern: /^#[0-9a-f]{3,8}$|\[(#|rgba?\(|hsla?\(|oklch\()/i,
    message: 'a raw colour; use a colour role (bg-island, text-error, ...)'
  },
  {
    pattern:
      /^(bg|text|border|ring|outline|divide|fill|stroke|shadow|accent|caret|decoration|from|via|to)(-[trblxy])?-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+)(\/\d+)?$/,
    message: 'a Tailwind palette colour; use a colour role'
  },
  {
    pattern: /^text-(xs|sm|base|lg|\d?xl|ui-.+|\[.+\])$/,
    message: 'a fixed text size; use a text style (type-body, type-hint, ...)'
  },
  {
    pattern: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
    message: 'a fixed font weight; use a text style (type-section-title, type-button, ...)'
  },
  {
    test: (name) => {
      const match = /^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-(.+))?$/.exec(name)
      return match !== null && !RADIUS_ROLES.has(match[1] ?? '')
    },
    message: 'a stock radius; use rounded-island, -component, -button, -popup or -banner'
  },
  {
    test: (name) => {
      const match = /^(?:min-h|h)-(\d+(?:\.\d+)?|\[.+\])$/.exec(name)
      return match !== null && (match[1]?.startsWith('[') || Number(match[1]) >= 5)
    },
    message: 'a fixed height; use a size role (h-tree-row, h-control, h-panel-header, ...)'
  },
  {
    test: (name) => {
      const match = /^size-(\d+(?:\.\d+)?)$/.exec(name)
      return match !== null && Number(match[1]) >= 6
    },
    message: 'a fixed control size; use a size role (size-icon-button, ...)'
  }
]

/** The utility a class applies, without its variants (`hover:`, `data-[state=open]:`) or `!`/`-`. */
function utility(token) {
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (char === '[') depth += 1
    else if (char === ']') depth -= 1
    else if (char === ':' && depth === 0) start = index + 1
  }
  return token.slice(start).replace(/^!?-?/, '').replace(/!$/, '')
}

const themeRolesOnly = {
  meta: {
    type: 'problem',
    messages: {
      raw: "'{{token}}' is {{why}}. Styling comes from the app theme (src/renderer/src/assets/main.css)."
    }
  },
  create(context) {
    const check = (node, text) => {
      for (const token of text.split(/\s+/)) {
        if (token === '') continue
        const name = utility(token)
        const failed = CHECKS.find((rule) =>
          rule.test ? rule.test(name) : rule.pattern.test(name)
        )
        if (failed) context.report({ node, messageId: 'raw', data: { token, why: failed.message } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      }
    }
  }
}

export default {
  meta: { name: 'theme' },
  rules: { 'roles-only': themeRolesOnly }
}
