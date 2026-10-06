from pathlib import Path
p = Path("src/App.tsx")
s = p.read_text()
s = s.replace('import "./App.css";', 'import { useEffect, useMemo, useState } from "react";\nimport "./App.css";\nimport { getAccounts, type LocalAccount } from "./localApi";')
s = s.replace("const accounts: Account[] = [", "const demoAccounts: Account[] = [")
marker = "function App() {\n  return ("
insert = """function initials(name: string) {
  return name.split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "MM";
}

function accountTone(index: number) {
  return ["blue", "violet", "rose"][index % 3];
}

function App() {
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    getAccounts().then(setLocalAccounts).catch(() => setLocalAccounts([]));
  }, []);

  const accounts = useMemo<Account[]>(() => {
    if (!localAccounts.length) return demoAccounts;
    return localAccounts.map((account, index) => ({
      name: account.name,
      platforms: account.facebookPageId && account.instagramAccountId
        ? "Facebook + Instagram"
        : account.facebookPageId
          ? "Facebook"
          : account.instagramAccountId
            ? "Instagram"
            : "Not connected",
      initials: initials(account.name),
      tone: accountTone(index),
    }));
  }, [localAccounts]);

  const selectedName = selectedAccountId
    ? localAccounts.find((account) => account.id === selectedAccountId)?.name ?? "All Accounts"
    : "All Accounts";

  return ("""
s = s.replace(marker, insert)
s = s.replace('<button className="all-accounts"><Library size={16}/><span>All Accounts</span><ChevronDown size={15}/></button>', '<button className="all-accounts" onClick={() => setSelectedAccountId(null)}><Library size={16}/><span>{selectedName}</span><ChevronDown size={15}/></button>')
old = """{accounts.map((account) => (
              <button key={account.name} className="account-row">
                <span className={\`account-avatar \${account.tone}\`}>{account.initials}</span>
                <span><b>{account.name}</b><small>{account.platforms}</small></span>
              </button>
            ))}"""
new = """{accounts.map((account, index) => {
              const local = localAccounts[index];
              const selected = local && selectedAccountId === local.id;
              return (
                <button
                  key={account.name}
                  className={\`account-row \${selected ? "selected-account" : ""}\`}
                  onClick={() => local && setSelectedAccountId(local.id)}
                >
                  <span className={\`account-avatar \${account.tone}\`}>{account.initials}</span>
                  <span><b>{account.name}</b><small>{account.platforms}</small></span>
                </button>
              );
            })}"""
s = s.replace(old, new)
s = s.replace('<span className="eyebrow"><Sparkles size={15}/> ALL ACCOUNTS</span>', '<span className="eyebrow"><Sparkles size={15}/> {selectedName.toUpperCase()}</span>')
p.write_text(s)
