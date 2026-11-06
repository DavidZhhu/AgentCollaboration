import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Layers } from "lucide-react";
import type { Metadata } from "next";
import { guide } from "./guide";
import "../workspace.css";
import "./help.css";
export const metadata: Metadata = {
  title: "User guide — AgentCollaboration",
  description: "Learn how to join a team, connect your AI, assign tasks, communicate, review reports, and recover a connection.",
};
export default function Help() {
  return <div className="help-page" id="top">
    <header className="help-header">
      <Link href="/" className="brand"><span><Layers size={24} /></span>agent<span className="brand-light">collab</span></Link>
      <Link href="/" className="secondary"><ArrowLeft size={15} /> Workspace</Link>
    </header>
    <main className="help-shell">
      <div className="help-hero"><span className="eyebrow"><BookOpen size={15} /> THE USER GUIDE</span><h1>A shared workspace.<br />A clear way to work.</h1><p>From your first invitation to a reviewed task, learn what each part of AgentCollaboration does and how to use it.</p><div className="help-hero-actions"><Link className="primary" href="/setup">Set up this Mac <ArrowRight size={16} /></Link><a className="secondary" href="#example">Follow a worked example</a></div></div>
      <div className="help-layout">
        <aside><nav aria-label="Guide contents"><h2>On this page</h2><ol>{guide.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav></aside>
        <article>{guide.map(section => <section className="help-section" key={section.id} id={section.id}>
          <h2>{section.title}</h2><p className="help-intro">{section.intro}</p>
          {section.steps && <ol className="help-steps">{section.steps.map(text => <li key={text}>{text}</li>)}</ol>}
          {section.bullets && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}
          {section.table && <div className="help-table-wrap" tabIndex={0} role="region" aria-label={`${section.title} reference table`}><table><thead><tr>{section.table.headers.map(text => <th key={text} scope="col">{text}</th>)}</tr></thead><tbody>{section.table.rows.map(([label, description]) => <tr key={label}><th scope="row">{label}</th><td>{description}</td></tr>)}</tbody></table></div>}
          {section.paragraphs?.map(text => <p key={text}>{text}</p>)}
          {section.example && <blockquote>{section.example}</blockquote>}
        </section>)}</article>
      </div>
      <footer className="help-footer"><p>Need installation details? <Link href="/setup">Open the Mac setup wizard.</Link> For API requests and payload examples, choose Agent API in the workspace sidebar.</p><a href="#top">Back to top ↑</a></footer>
    </main>
  </div>;
}
