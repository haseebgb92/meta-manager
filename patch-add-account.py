from pathlib import Path
p = Path("src/App.tsx")
s = p.read_text()

s = s.replace(
    'import { getAccounts, type LocalAccount } from "./localApi";',
    'import { createAccount, getAccounts, type LocalAccount } from "./localApi";'
)

s = s.replace(
    '  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);',
    '  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);\n  const [showAddAccount, setShowAddAccount] = useState(false);\n  const [newAccountName, setNewAccountName] = useState("");\n  const [savingAccount, setSavingAccount] = useState(false);'
)

anchor = '''  const selectedName = selectedAccountId
    ? localAccounts.find((account) => account.id === selectedAccountId)?.name ?? "All Accounts"
    : "All Accounts";
'''
replacement = anchor + '''
  async function handleAddAccount() {
    const name = newAccountName.trim();
    if (!name || savingAccount) return;
    setSavingAccount(true);
    try {
      const account = await createAccount(name);
      setLocalAccounts((current) => [...current, account]);
      setSelectedAccountId(account.id);
      setNewAccountName("");
      setShowAddAccount(false);
    } finally {
      setSavingAccount(false);
    }
  }
'''
s = s.replace(anchor, replacement)

s = s.replace(
    '<button className="account-row add"><span className="account-avatar add"><Plus size={15}/></span><span><b>Add Account</b><small>Connect Meta</small></span></button>',
    '<button className="account-row add" onClick={() => setShowAddAccount(true)}><span className="account-avatar add"><Plus size={15}/></span><span><b>Add Account</b><small>Create workspace</small></span></button>'
)

modal = '''
      {showAddAccount && (
        <div className="modal-backdrop" onMouseDown={() => setShowAddAccount(false)}>
          <section className="account-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-icon"><Plus size={20}/></div>
            <div>
              <span className="eyebrow">NEW WORKSPACE</span>
              <h2>Add social account</h2>
              <p>Create the local workspace first. Meta connection comes next.</p>
            </div>
            <label className="modal-field">
              <span>Account / brand name</span>
              <input
                autoFocus
                value={newAccountName}
                onChange={(event) => setNewAccountName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleAddAccount()}
                placeholder="e.g. Advertpreneur"
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowAddAccount(false)}>Cancel</button>
              <button className="primary" onClick={handleAddAccount} disabled={!newAccountName.trim() || savingAccount}>
                {savingAccount ? "Creating..." : "Create workspace"}
              </button>
            </div>
          </section>
        </div>
      )}
'''
s = s.replace('    </main>\n  );', '    </main>\n' + modal + '  );')

p.write_text(s)
