import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function App() {
  const [items, setItems] = useState([]); const [mode, setMode] = useState('local');
  const [tab, setTab] = useState('all'); const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(false); const [kind, setKind] = useState('note');
  const [note, setNote] = useState(''); const [url, setUrl] = useState(''); const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState(''); const [asking, setAsking] = useState(false); const [result, setResult] = useState(null); const [notice, setNotice] = useState('');
  async function refresh() { try { const data = await api('/items'); setItems(data.items); } catch (e) { setNotice(e.message); } }
  useEffect(() => { refresh(); api('/health').then((x) => setMode(x.ai)).catch(() => {}); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  async function save(e) {
    e.preventDefault(); setSaving(true);
    try { await api('/ingest', kind === 'note' ? { type: 'note', text: note } : { type: 'url', url }); setNote(''); setUrl(''); setModal(false); await refresh(); setNotice('Saved to your inbox.'); }
    catch (error) { setNotice(error.message); } finally { setSaving(false); }
  }
  async function ask(e) {
    e.preventDefault(); if (!question.trim()) return; setAsking(true); setResult(null);
    try { setResult(await api('/query', { question })); } catch (error) { setNotice(error.message); } finally { setAsking(false); }
  }
  const visible = items.filter((item) => (tab === 'all' || item.source_type === tab) && (!filter || `${item.title} ${item.preview}`.toLowerCase().includes(filter.toLowerCase())));
  const date = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));

  return <div className="layout">
    <aside className="sidebar"><a className="brand" href="#top"><span className="brand-icon">✧</span>stillnote<span className="period">.</span></a>
      <div className="section-label">YOUR SPACE</div><button className="side-link current" onClick={() => setTab('all')}><span>▤</span>My inbox <b>{items.length}</b></button><button className="side-link" onClick={() => { setKind('note'); setModal(true); }}><span>＋</span>Add something</button>
      <div className="sidebar-bottom"><div className="thought"><span>✧</span><div><strong>A little thought goes a long way.</strong><p>Save the things you want to find again.</p></div></div><div className="profile"><span className="avatar">S</span><div><strong>Your workspace</strong><small>Private by default</small></div><i/></div></div>
    </aside>
    <main id="top"><header className="topbar"><span>Workspace <i>/</i> <b>My inbox</b></span><span className="mode"><i/> {mode === 'openai' ? 'AI answers on' : 'Local mode'}</span></header>
      <div className="content"><section className="hero"><div><div className="eyebrow">A SPACE FOR YOUR CURIOSITY</div><h1>Keep what <em>matters.</em></h1><p>A thought, a link, a little spark. Save it here, and find it when you need it.</p></div><div className="orbit-art"><div className="orbit o1"/><div className="orbit o2"/><div className="sun">✧</div><span>✳</span></div></section>
        <section className="ask-card"><div className="ask-title"><span className="ask-icon">✧</span><div><h2>Ask your inbox</h2><p>Get a little help finding what you’ve saved.</p></div><label>{mode === 'openai' ? '✧ AI-powered' : '✧ Ready when you are'}</label></div>
          <form className="question" onSubmit={ask}><span>⌕</span><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything about your saved notes and links…" aria-label="Ask a question"/><button disabled={asking || !question.trim()}>{asking ? 'Searching…' : 'Ask　➤'}</button></form>
          {!result ? <div className="suggestions"><small>TRY ASKING</small>{['What should I remember?', 'Find a useful idea', 'What have I been reading?'].map((text) => <button key={text} onClick={() => setQuestion(text)}>{text}</button>)}</div> : <div className="answer"><div className="eyebrow">✦ &nbsp;A NOTE BACK TO YOU</div><p>{result.answer}</p><div className="source-heading">FROM YOUR INBOX <span>{result.sources.length} sources</span></div>{result.sources.map((source) => <div className="source" key={source.id}><span>{source.source_type === 'url' ? '↗' : '▤'}</span><div><strong>{source.title}</strong><p>{source.snippet}</p></div>{source.source_url && <a href={source.source_url} target="_blank" rel="noreferrer">↗</a>}</div>)}<button className="ask-again" onClick={() => setResult(null)}>Ask another ↗</button></div>}
        </section>
        <section className="collection"><div className="collection-top"><div className="eyebrow">YOUR COLLECTION</div><div className="collection-title"><h2>In your inbox</h2><b>{items.length}</b></div><button className="add-button" onClick={() => { setKind('note'); setModal(true); }}>＋ &nbsp;Add to inbox</button></div>
          <div className="toolbar"><div className="tabs"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Everything <small>{items.length}</small></button><button className={tab === 'note' ? 'active' : ''} onClick={() => setTab('note')}>▤ &nbsp;Notes</button><button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>↗ &nbsp;Links</button></div><label className="filter">⌕ <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in inbox"/></label></div>
          {visible.length ? <div className="grid">{visible.map((item) => <article className="item" key={item.id}><div className="item-meta"><span>{item.source_type === 'url' ? '↗ LINK' : '▤ NOTE'}</span><time>{date(item.created_at)}</time></div><h3>{item.title}</h3><p>{item.preview}{item.preview.length >= 220 ? '…' : ''}</p>{item.source_url && <a className="domain" href={item.source_url} target="_blank" rel="noreferrer">{new URL(item.source_url).hostname.replace(/^www\./, '')} ↗</a>}<button className="ask-item" onClick={() => setQuestion(`What does “${item.title}” say?`)}>✧ Ask about this</button></article>)}</div> : <div className="empty"><span>▤</span><h3>{filter ? 'Nothing found just yet.' : 'Your inbox is a blank page.'}</h3><p>{filter ? 'Try a different word or browse your whole inbox.' : 'Save something worth remembering. Your future self will thank you.'}</p>{!filter && <button onClick={() => { setKind('note'); setModal(true); }}>＋ &nbsp;Add your first note</button>}</div>}
        </section><footer>Made for the things you don’t want to lose. <span>✿</span></footer>
      </div>
    </main>
    {modal && <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}><section className="modal" role="dialog" aria-modal="true"><button className="close" onClick={() => setModal(false)}>×</button><div className="eyebrow">SAVE FOR LATER</div><h2>Add to your inbox</h2><p className="modal-sub">Give a good thought somewhere to land.</p><div className="modal-tabs"><button className={kind === 'note' ? 'chosen' : ''} onClick={() => setKind('note')}>▤ &nbsp;Write a note</button><button className={kind === 'url' ? 'chosen' : ''} onClick={() => setKind('url')}>↗ &nbsp;Save a link</button></div><form onSubmit={save}>{kind === 'note' ? <label className="field">YOUR THOUGHT<textarea autoFocus rows="6" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A quote, an idea, a reminder to future you…" maxLength="100000"/></label> : <label className="field">PAGE URL<input autoFocus type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://somewhere-wonderful.com"/><small>We’ll bring the readable page text into your inbox.</small></label>}<div className="modal-bottom"><span>● &nbsp;Just for your workspace</span><button disabled={saving || (kind === 'note' ? !note.trim() : !url.trim())}>{saving ? 'Saving…' : 'Save to inbox ↗'}</button></div></form></section></div>}
    {notice && <div className="toast" role="status">✓ &nbsp;{notice}<button onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
