import type { Client } from "./domain";
export type ClientQuery = { name: string; email: string; phone: string };
export default function ClientSearch({
  query,
  onQuery,
  results,
  busy,
  searched,
  onSearch,
  onSelect,
}: {
  query: ClientQuery;
  onQuery: (q: ClientQuery) => void;
  results: Client[];
  busy: boolean;
  searched: boolean;
  onSearch: () => void;
  onSelect: (c: Client) => void;
}) {
  return (
    <section className="panel">
      <h1>Client Search</h1>
      <p>
        Fill in any field. When you fill in several, results must match all of
        them.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="client-search"
      >
        {(["name", "email", "phone"] as const).map((k) => (
          <label key={k}>
            {k === "name"
              ? "Name"
              : k === "email"
                ? "Email Address"
                : "Phone Number"}
            <input
              value={query[k]}
              onChange={(e) => onQuery({ ...query, [k]: e.target.value })}
            />
          </label>
        ))}
        <button className="primary" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      <div className="search-results">
        {results.map((c) => (
          <button
            className="history-card"
            key={c.id}
            disabled={busy}
            onClick={() => onSelect(c)}
          >
            <strong>{c.name}</strong>
            <span>
              {c.email} · {c.phone}
            </span>
            <span>Select →</span>
          </button>
        ))}
      </div>
      {searched && !results.length && (
        <p>No matching clients. Try fewer details or create a new client.</p>
      )}
    </section>
  );
}
