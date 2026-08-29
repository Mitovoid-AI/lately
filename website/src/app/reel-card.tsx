import type { Reel } from "@/lib/types";
import { RetryButton } from "./retry-button";

function statusClass(status: Reel["status"]): string {
  return `status-${status}`;
}

export function ReelCard({ reel }: { reel: Reel }) {
  return (
    <article className="card">
      <div className="card-head">
        <span className={statusClass(reel.status)}>{reel.status}</span>
        <span className="channel">via {reel.source_channel}</span>
        {reel.category ? <span className="cat">{reel.category}</span> : null}
      </div>

      {reel.thumbnail_path ? (
        // Instagram CDN hosts vary; plain img avoids next/image host config.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={reel.thumbnail_path} alt="" />
      ) : null}

      <h2>{reel.title ?? reel.reason ?? reel.source_url}</h2>

      {reel.summary ? <p className="summary">{reel.summary}</p> : null}

      {reel.steps && reel.steps.length > 0 ? (
        <ol className="steps">
          {reel.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}

      {reel.tags && reel.tags.length > 0 ? (
        <div className="tags">
          {reel.tags.map((t) => (
            <span className="tag" key={t}>
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      <a className="src" href={reel.source_url} target="_blank" rel="noreferrer">
        {reel.source_url}
      </a>

      {reel.status === "partial" ? (
        <>
          {reel.failure_reason ? (
            <p className="err">{reel.failure_reason}</p>
          ) : null}
          <RetryButton id={reel.id} />
        </>
      ) : null}
    </article>
  );
}
