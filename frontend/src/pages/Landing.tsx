import { useEffect, useRef, useState } from 'react';
import './landing.css';

// Product documentation, not sample investigations or live workspace data.
// Runtime contracts and source links: docs/extending-the-framework.md.
const stages = [
  { name: 'Understand', detail: 'Start with your question', description: 'Describe what happened and what you need to understand. RCA assist finds an available investigation or asks for the context it needs.', output: 'A question with a clear scope' },
  { name: 'Gather', detail: 'Bring the evidence together', description: 'Approved tools read the connected sources your project permits. You can also attach local documents and logs for review.', output: 'Source records and extracted text' },
  { name: 'Investigate', detail: 'Apply your team’s expertise', description: 'Specialist agents use the skills assigned to the workflow to inspect the evidence. You can follow the recorded stages and tool activity.', output: 'Findings linked to their evidence' },
  { name: 'Review', detail: 'Make an informed next move', description: 'Read the findings, source references, uncertainties, and suggested next steps. When evidence is missing, the result says so.', output: 'A result your team can review' },
];

const questions = [
  ['Do I need to write code to investigate?', 'No. Open your project’s Chat, describe the issue, and add any relevant files. RCA assist chooses an available investigation and asks when it needs more context. Your project controls which sources it can use.'],
  ['What does adding a skill do?', 'A skill gives an agent reusable instructions for a specific task. A platform administrator can propose a skill for existing workflows. Another administrator reviews it before it becomes active. It can use only the registered actions those workflows already allow.'],
  ['Can a skill connect to a new system?', 'A skill alone does not create an integration. A supported connector must be configured and enabled for your project first. Skills then guide how agents use its permitted tools.'],
  ['Can I see how an answer was reached?', 'The investigation workspace exposes recorded stages, tool activity, evidence, and artifacts. Findings include evidence references so you can review the sources and understand any uncertainty.'],
  ['Will investigations change my systems?', 'The supported live Jira and Splunk investigation paths read data. They do not create or update Jira issues. Arbitrary code execution and database queries are not part of this release.'],
  ['How do I get workspace access?', 'Sign in with your company account after your administrator connects single sign-on and grants project access. RCA assist verifies your identity and membership before opening the workspace.'],
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h15m-6-6 6 6-6 6" />}
  </svg>;
}

function Brand() {
  return <a className="landing-brand" href="/" aria-label="RCA assist home"><svg width="30" height="32" viewBox="0 0 30 32" aria-hidden="true" fill="none"><path d="M4 27V5h11a7 7 0 0 1 0 14H4m10 0 10 8" stroke="currentColor" strokeWidth="3" /><path d="M10 11h6" stroke="var(--landing-accent)" strokeWidth="2" /></svg><span>RCA assist</span></a>;
}

export function Landing() {
  const [stage, setStage] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedStage = stages[stage];

  useEffect(() => {
    document.title = 'RCA assist | Understand the incident. See the evidence.';
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.classList.add('landing-visible');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.3 });
    rootRef.current?.querySelectorAll('.landing-reveal-word').forEach(element => observer.observe(element));
    return () => { observer.disconnect(); document.body.classList.remove('landing-visible'); };
  }, []);

  return <div className="landing" ref={rootRef}>
    <a className="landing-skip" href="#main">Skip to content</a>
    <header className="landing-header">
      <Brand />
      <button className="landing-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(value => !value)}><span /><span /></button>
      <nav id="landing-navigation" aria-label="Main navigation" className={menuOpen ? 'is-open' : ''} onKeyDown={event => { if (event.key === 'Escape') setMenuOpen(false); }}>
        <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
        <a href="#skills" onClick={() => setMenuOpen(false)}>Extend with skills</a>
        <a href="#questions" onClick={() => setMenuOpen(false)}>Questions</a>
      </nav>
      <a className="landing-button landing-button-small" href="/workspace">Open workspace <Arrow /></a>
    </header>

    <main id="main" tabIndex={-1}>
      <section className="landing-hero landing-container" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title">Understand<br />the incident.<br /><span>See the evidence.</span></h1>
          <p>Bring your sources, your questions, and your team’s expertise together. RCA assist helps you investigate what happened and decide what comes next.</p>
          <a className="landing-button" href="/workspace">Open workspace <Arrow /></a>
          <div className="landing-proof"><svg aria-hidden="true" className="landing-proof-mark" width="16" height="16" viewBox="0 0 16 16"><path d="m4 8 3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>Powered by Google Agent Development Kit</div>
        </div>
        <div className="landing-workflow" aria-label="How an investigation works">
          <div className="landing-workflow-heading"><span>Every finding has a path.</span><span className="landing-workflow-caption">Explore the process</span></div>
          <div className="landing-source-row"><span>Tickets</span><span>Logs</span><span>Attachments</span></div>
          <div className="landing-workflow-line" aria-hidden="true" />
          <div className="landing-stage-list" role="group" aria-label="Investigation stages">
            {stages.map((item, index) => <button key={item.name} aria-pressed={stage === index} aria-controls="landing-stage-detail" className={`landing-stage ${stage === index ? 'is-selected' : ''}`} onClick={() => setStage(index)}><span className="landing-stage-number">{index + 1}</span><span>{item.name}</span><Arrow /></button>)}
          </div>
          <div className="landing-stage-detail" id="landing-stage-detail" aria-live="polite" aria-atomic="true">
            <h2>{selectedStage.detail}</h2><p>{selectedStage.description}</p><div className="landing-stage-output"><span>What you get</span><strong>{selectedStage.output}</strong></div>
          </div>
          <div className="landing-workflow-foot">Your team stays in control of the next step.</div>
        </div>
      </section>

      <div className="landing-principles landing-container"><span>Evidence you can inspect</span><span>Skills you can extend</span><span>Access your team controls</span></div>

      <section className="landing-section landing-container" id="how-it-works" aria-labelledby="how-heading">
        <div className="landing-section-heading"><h2 id="how-heading">From a question<br />to a clearer picture.</h2><p>A guided investigation, with the details close at hand. Use your workspace to follow the work and review the result.</p></div>
        <ol className="landing-steps">
          <li><span className="landing-step-number">1</span><h3>Bring the context</h3><p>Describe the issue and add relevant files. RCA assist uses an available investigation with your project’s permitted sources.</p></li>
          <li><span className="landing-step-number">2</span><h3>Follow the investigation</h3><p>See the recorded stages, tools, and collected evidence as specialist agents work through the question.</p></li>
          <li><span className="landing-step-number">3</span><h3>Review what matters</h3><p>Read the findings with their sources, uncertainties, and recommended next steps. Keep the context for follow up.</p></li>
        </ol>
      </section>

      <section className="landing-extension" id="skills" aria-labelledby="skills-heading">
        <div className="landing-container landing-extension-grid">
          <div><h2 id="skills-heading">Your expertise.<br />A reusable skill.</h2><p>Turn your team’s way of investigating into instructions an agent can use again. Add a skill, connect it to an existing workflow, and have it reviewed before your team uses it.</p><a href="/admins/skills" className="landing-text-link">Manage your skills <Arrow /></a><small>Platform administrator access required to add skills.</small></div>
          <div className="landing-skill-recipe" aria-label="Skill setup steps">
            <div><span>Define</span><h3>What should the agent know?</h3><p>Give the skill a clear name and describe when it is useful.</p></div>
            <div><span>Guide</span><h3>How should it investigate?</h3><p>Write the steps, evidence to look for, and limits to respect.</p></div>
            <div><span>Connect</span><h3>Where should the skill run?</h3><p>Choose existing workflows and the permitted actions it needs.</p></div>
            <div><span>Review</span><h3>Ready for your team?</h3><p>Another administrator approves the exact instructions before they run.</p></div>
            <p className="landing-skill-note">Skills extend instructions. Your project’s tool permissions and connector boundaries still apply.</p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-container landing-foundation" aria-labelledby="foundation-heading">
        <div className="landing-section-heading"><h2 id="foundation-heading">The building blocks,<br />working together.</h2><p>Google ADK provides the agent foundation. RCA assist brings the configuration, evidence, and review experience into one workspace.</p></div>
        <div className="landing-foundation-list">
          <details open><summary><span>Agents, tools & orchestration</span><span className="landing-details-symbol" aria-hidden="true" /></summary><p>Specialist agents work through a configured workflow. Registered tools collect permitted evidence, and workflow stages bring it together for synthesis.</p></details>
          <details><summary><span>Sessions, evidence & artifacts</span><span className="landing-details-symbol" aria-hidden="true" /></summary><p>Runs and events are persisted. Collected evidence and artifacts remain available in the investigation workspace for inspection and follow up.</p></details>
          <details><summary><span>Configuration & access</span><span className="landing-details-symbol" aria-hidden="true" /></summary><p>Administrators manage configuration and project requirements. Server verified membership determines access; a skill cannot expand those permissions.</p></details>
          <details><summary><span>Checks, review & traceability</span><span className="landing-details-symbol" aria-hidden="true" /></summary><p>Inspect execution traces and validate instruction changes. Offline checks verify specific contracts; they do not measure live model accuracy. New skills, project knowledge, and custom agent definitions require independent approval.</p></details>
        </div>
      </section>

      <section className="landing-statement landing-container" aria-label="Our approach"><p>{['Less', 'guesswork.', 'More', 'understanding.'].map((word, index) => <span key={word} className="landing-reveal-word" style={{ transitionDelay: `${index * 90}ms` }}>{word}{index === 1 ? <br /> : ' '}</span>)}</p><span>Make the evidence part of the conversation.</span></section>

      <section className="landing-section landing-container landing-faq" id="questions" aria-labelledby="questions-heading"><h2 id="questions-heading">A few things<br />worth knowing.</h2><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span className="landing-details-symbol" aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>

      <section className="landing-final landing-container"><div><h2>Start with a better question.<br />Leave with evidence.</h2><p>Your next investigation starts in your workspace.</p></div><a href="/workspace" className="landing-button">Open workspace <Arrow /></a></section>
    </main>
    <footer className="landing-footer landing-container"><Brand /><span>Root cause analysis, with context.</span><a href="https://google.github.io/adk-docs/" target="_blank" rel="noreferrer">Built on Google ADK <Arrow diagonal /></a><a href="#questions">Access & data</a></footer>
  </div>;
}

export function PageNotFound() {
  return <main className="landing-not-found"><Brand /><h1>This page could not be found.</h1><p>Check the address or return to RCA assist to open your workspace.</p><a className="landing-button" href="/">Return to RCA assist <Arrow /></a></main>;
}
