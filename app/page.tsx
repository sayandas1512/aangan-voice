import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.brand}>
          <span className={styles.mark}>A</span>
          <span>Aangan Studio</span>
        </div>

        <h1 className={styles.title}>Every call answered. Every enquiry qualified.</h1>
        <p className={styles.lede}>
          Aangan Studio&apos;s AI assistant picks up when the front desk can&apos;t. It asks the right questions, books a
          consultation with a designer, and sends them the whole story before the meeting.
        </p>

        <div className={styles.actions}>
          <Link href="/talk" className={styles.primary}>
            Talk to the assistant
          </Link>
          <Link href="/dashboard" className={styles.secondary}>
            Open the founder dashboard
          </Link>
        </div>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.num}>1</span>
            <h2>Answers, day or night</h2>
            <p>Picks up every call and speaks the caller&apos;s own language — including the ones that used to go to voicemail after 7pm.</p>
          </li>
          <li className={styles.step}>
            <span className={styles.num}>2</span>
            <h2>Qualifies like the studio would</h2>
            <p>Checks each enquiry against the founder&apos;s own criteria — and never quotes a price, however hard it&apos;s pressed.</p>
          </li>
          <li className={styles.step}>
            <span className={styles.num}>3</span>
            <h2>Books and hands off</h2>
            <p>Books the consultation, emails the designer a clear brief, and creates the deal in HubSpot.</p>
          </li>
        </ol>

        <p className={styles.foot}>Built for Aangan Studio, Pune.</p>
      </main>
    </div>
  );
}
