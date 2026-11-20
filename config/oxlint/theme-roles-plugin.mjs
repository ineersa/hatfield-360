// Keeps renderer styling on the app theme's roles (src/renderer/src/assets/main.css): class names
// and literal JSX style values with raw colours, text sizes or weights, radii or fixed sizes are reported.
const RADIUS_ROLES = new Set(['island', 'component', 'button', 'popup', 'banner', 'full', 'none'])

const COLOUR_FUNCTION = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
// Bare words in a value that are not colour names (`inset_0_1px_red` names one; `transparent` doesn't).
const NOT_COLOURS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'none',
  'inset',
  'auto',
  'solid',
  'dashed',
  'dotted',
  'double'
])

/** Whether a CSS value names a colour itself rather than reading a role (`var(--x)`). */
function writesColour(value) {
  const withoutVars = value.replace(/var\([^)]*\)/g, '')
  if (COLOUR_FUNCTION.test(withoutVars)) return true
  return withoutVars
    .split(/[\s_,/]+/)
    .some((word) => /^[a-z]+$/i.test(word) && !NOT_COLOURS.has(word.toLowerCase()))
}

const COLOUR_UTILITY =
  /^(bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|fill|stroke|shadow|inset-shadow|accent|caret|decoration|from|via|to)-\[(.+)\]$/

// Inline style properties that are theme roles when written as a literal.
const THEMED_STYLE =
  /colou?r|background|fill|stroke|shadow|outline|border|font|radius|lineHeight|letterSpacing/i

const CHECKS = [
  {
    pattern: /^#[0-9a-f]{3,8}$|\[(#|rgba?\(|hsla?\(|oklch\()/i,
    message: 'a raw colour; use a colour role (bg-island, text-error, ...)'
  },
  {
    test: (name) => {
      const match = COLOUR_UTILITY.exec(name)
      if (match === null) return false
      const value = match[2] ?? ''
      // A type hint (`[color:...]`) says it is a colour; `[length:2px]` and the like don't.
      const hint = /^([a-z-]+):(.+)$/.exec(value)
      if (hint) return hint[1] === 'color' && writesColour(hint[2] ?? '')
      return writesColour(value)
    },
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
      const match = /^size-(\d+(?:\.\d+)?|\[.+\])$/.exec(name)
      return match !== null && (match[1]?.startsWith('[') || Number(match[1]) >= 6)
    },
    message:
      'a fixed control size; use a size role (size-icon-button, ...) or a glyph size below size-6'
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
    /** Literal values of a style object, including both sides of a `cond ? 'a' : 'b'`. */
    const literals = (node) => {
      if (node.type === 'Literal') return [node]
      if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return [node]
      if (node.type === 'ConditionalExpression')
        return [...literals(node.consequent), ...literals(node.alternate)]
      if (node.type === 'LogicalExpression') return literals(node.right)
      return []
    }
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return
        const style = node.value.expression
        if (style.type !== 'ObjectExpression') return
        for (const property of style.properties) {
          if (property.type !== 'Property' || property.computed) continue
          const key = property.key.type === 'Identifier' ? property.key.name : property.key.value
          if (typeof key !== 'string' || !THEMED_STYLE.test(key)) continue
          for (const literal of literals(property.value)) {
            if (
              literal.type === 'Literal' &&
              (literal.value === null || literal.value === undefined)
            )
              continue
            const text =
              literal.type === 'Literal'
                ? String(literal.value)
                : (literal.quasis[0]?.value.cooked ?? '')
            context.report({
              node: literal,
              messageId: 'raw',
              data: {
                token: `${key}: ${text}`,
                why: 'a fixed inline style; read it from the theme or settings, or use a role class'
              }
            })
          }
        }
      },
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
