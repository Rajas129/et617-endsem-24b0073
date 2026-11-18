import Link from "next/link";

const ROLL_NO = process.env.NEXT_PUBLIC_ROLL_NO ?? "24B0073";

export const metadata = { title: "About · Food Web Council" };

export default function About() {
  return (
    <>
      <main className="shell">
        <header className="topbar">
          <span className="title">About</span>
          <span className="step">ET 617</span>
        </header>

        <div className="card">
          <h2>Food Web Council</h2>
          <p className="muted">
            A Class 7 activity about what happens to a food web when one species is
            removed. Three AI helpers take different roles, sometimes disagree, and
            the learner settles the argument by running the experiment.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Identity token: {ROLL_NO}</strong>
          </p>
        </div>

        <div className="card">
          <h3>Exam card</h3>
          <table className="outcomes">
            <tbody>
              <tr><td>P — Problem</td><td>P3 Multi-agent collaborative learning environment</td></tr>
              <tr><td>T — Topic</td><td>P3-T4 Food chains: effect of removing a species (Cl. 7)</td></tr>
              <tr><td>L — Learner</td><td>L5 Repeating the topic after failing it once; high anxiety, low self-efficacy</td></tr>
              <tr><td>C — Constraint</td><td>C1 Low bandwidth</td></tr>
              <tr><td>ID</td><td>{ROLL_NO}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>The three helpers</h3>
          <p><strong>Mira</strong> explains and scaffolds. She is the only one who may say what to do next.</p>
          <p><strong>Aarav</strong> is a classmate. He challenges reasoning and is often wrong — on purpose.</p>
          <p style={{ marginBottom: 0 }}>
            <strong>Dr. Sen</strong> is the only helper who sees the simulation. He checks
            claims against it and gives feedback.
          </p>
        </div>

        <div className="card">
          <h3>Where the AI is, and where it isn&apos;t</h3>
          <p>
            The population simulation is ordinary arithmetic running in your browser.
            No AI is involved in it, and it needs no internet. It is the ground truth.
          </p>
          <p>
            The helpers are Gemma language models, running on three separate keys so
            that one busy key cannot stop a round. Mira and Aarav never see the
            simulation, so their predictions are honest guesses and can be wrong.
            Dr. Sen sees it, and every factual claim he makes is checked against the
            numbers before it reaches you. If a claim does not match, his reply is
            thrown away and replaced by a summary generated straight from the
            simulation.
          </p>
          <p style={{ marginBottom: 0 }}>
            If the model is unavailable, the app says so and shows a saved example
            conversation. You can still run every experiment.
          </p>
        </div>

        <div className="card">
          <h3>Low bandwidth</h3>
          <p style={{ marginBottom: 0 }}>
            No images, no video, no audio, no web fonts. The food web and the charts are
            drawn as inline shapes. Two model calls per round at most, each on its own
            key, and your place is saved on your own device so a dropped connection
            never loses your work. The footer shows how much data this session has used.
          </p>
        </div>

        <div className="nav">
          <Link href="/"><button className="inline">← Back to the activity</button></Link>
        </div>
      </main>
      <footer className="footer">
        <div className="inner">
          <span>ET 617 · <strong>{ROLL_NO}</strong> · About</span>
          <span className="data">no data used on this page</span>
        </div>
      </footer>
    </>
  );
}
