export default async function SettingsPage() {
  const env = {
    NEAR_NETWORK: process.env.NEAR_NETWORK || 'testnet',
    NEAR_NODE_URL: process.env.NEAR_NODE_URL || '',
    NEAR_ACCOUNT_ID: process.env.NEAR_ACCOUNT_ID || '',
    NEAR_ESCROW_ACCOUNT_ID: process.env.NEAR_ESCROW_ACCOUNT_ID || '',
    NEAR_INTENTS_ACCOUNT_ID: process.env.NEAR_INTENTS_ACCOUNT_ID || ''
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">Settings</h2>
      <p className="text-sm text-gray-600">Runtime environment used by server actions.</p>
      <div className="grid grid-cols-1 gap-3">
        <Item label="NEAR_NETWORK" value={env.NEAR_NETWORK} />
        <Item label="NEAR_NODE_URL" value={env.NEAR_NODE_URL} />
        <Item label="NEAR_ACCOUNT_ID" value={env.NEAR_ACCOUNT_ID} />
        <Item label="NEAR_ESCROW_ACCOUNT_ID" value={env.NEAR_ESCROW_ACCOUNT_ID} />
        <Item label="NEAR_INTENTS_ACCOUNT_ID" value={env.NEAR_INTENTS_ACCOUNT_ID} />
      </div>
      <p className="text-xs text-gray-500">To change these, edit your repo .env at the project root and restart the dev server.</p>
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 p-3">
      <span className="text-sm text-gray-600">{label}</span>
      <code className="text-xs">{value || '—'}</code>
    </div>
  )
}
