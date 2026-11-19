// Flags raw Electron IPC registration that import restrictions can't see (`webContents.ipc`, `electron.ipcMain`,
// destructuring), so every main-process handler goes through handleTrusted's sender check.
const RAW_IPC_NAMES = new Set(['ipcMain', 'ipc'])

function staticName(node, computed) {
  if (!computed && node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

const noRawIpcRegistration = {
  meta: {
    type: 'problem',
    messages: {
      raw: "Raw '{{name}}' access bypasses the IPC sender check. Register handlers with handleTrusted from src/main/ipc/trusted-ipc.ts."
    }
  },
  create(context) {
    const reportIfRaw = (node, name) => {
      if (name !== null && RAW_IPC_NAMES.has(name))
        context.report({ node, messageId: 'raw', data: { name } })
    }
    return {
      MemberExpression(node) {
        reportIfRaw(node.property, staticName(node.property, node.computed))
      },
      Property(node) {
        if (node.parent.type === 'ObjectPattern')
          reportIfRaw(node.key, staticName(node.key, node.computed))
      },
      ImportSpecifier(node) {
        reportIfRaw(node.imported, staticName(node.imported, false))
      }
    }
  }
}

export default {
  meta: { name: 'hatfield' },
  rules: { 'no-raw-ipc-registration': noRawIpcRegistration }
}
