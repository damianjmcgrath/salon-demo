import { useEffect, useRef, useState } from "react";
import RevolutCheckout from "@revolut/checkout";
import type { SupabaseClient } from "@supabase/supabase-js";
export default function BookingGuarantee({
  db,
  clientId,
  onChange,
}: {
  db: SupabaseClient;
  clientId?: string;
  onChange: (id: string, consent: boolean) => void;
}) {
  const [cards, setCards] = useState<
    { id: string; brand: string; last_four: string | null }[]
  >([]);
  const [choice, setChoice] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [owner, setOwner] = useState({ name: "", email: "" }),
    [name, setName] = useState(""),
    [setup, setSetup] = useState(""),
    [ready, setReady] = useState(false);
  const started = useRef(false);
  const [retryCheck, setRetryCheck] = useState(false);
  const target = useRef<HTMLDivElement>(null),
    mounted = useRef(true);
  const card = useRef<ReturnType<
    Awaited<ReturnType<typeof RevolutCheckout>>["createCardField"]
  > | null>(null);
  async function call(action: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await db.functions.invoke("booking-guarantee", {
      body: { action, client_id: clientId, ...extra },
    });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : "Card setup failed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    onChange("", false);
    void call("list")
      .then((data) => {
        if (!mounted.current) return;
        setCards(data.cards);
        setOwner({ name: data.owner_name, email: data.owner_email });
        setName(data.owner_name);
        const defaultChoice = data.cards[0]?.id || "new";
        setChoice(defaultChoice);
        onChange(defaultChoice === "new" ? "" : defaultChoice, false);
      })
      .catch((e) => {
        if (mounted.current) setMessage(e.message);
      });
    return () => {
      mounted.current = false;
      card.current?.destroy();
    };
  }, [clientId, db]);
  async function verify(id = setup) {
    setRetryCheck(false);
    let data;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!mounted.current) return;
      try {
        data = await call("verify", { card_id: id });
      } catch (error) {
        if (mounted.current) setRetryCheck(true);
        throw error;
      }
      if (!mounted.current) return;
      if (data.verified) break;
      if (attempt < 7)
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    if (!data?.verified) {
      setRetryCheck(true);
      setMessage(
        "Revolut has not confirmed your card yet. Please try checking again.",
      );
      return;
    }
    setCards((previous) => [
      { id: data.id, brand: data.brand, last_four: data.last_four },
      ...previous.filter((c) => c.id !== data.id),
    ]);
    setChoice(data.id);
    setReady(false);
    card.current?.destroy();
    card.current = null;
    onChange(data.id, consent);
    setMessage("Card verified. You can now confirm your appointment.");
  }
  async function start() {
    started.current = true;
    await run(async () => {
      const data = await call("create", { consent });
      if (!mounted.current) return;
      setSetup(data.id);
      const instance = await RevolutCheckout(data.token, "sandbox");
      if (!mounted.current) return;
      if (!target.current) throw new Error("Card field unavailable.");
      card.current?.destroy();
      card.current = instance.createCardField({
        target: target.current,
        onSuccess() {
          if (mounted.current) {
            setBusy(false);
            void run(() => verify(data.id));
          }
        },
        onError(error) {
          if (mounted.current) {
            setMessage(String(error));
            setBusy(false);
          }
        },
        onCancel() {
          if (mounted.current) {
            setMessage("Card setup cancelled.");
            setBusy(false);
          }
        },
      });
      setReady(true);
    });
  }
  useEffect(() => {
    if (
      choice === "new" &&
      consent &&
      owner.email &&
      !started.current &&
      !busy
    ) {
      void start();
    }
  }, [choice, consent, owner.email, busy]);
  return (
    <div className="guarantee">
      <p>
        No payment will be taken now. Pay for your treatment in the salon. Your
        saved card may be charged €10 if you do not attend.
      </p>
      <p className="small">
        <strong>Revolut Sandbox:</strong> use test cards only. No real money
        will be taken. Late-cancellation charges are not enabled yet.
      </p>
      <p>
        Guarantee card owner: <strong>{owner.name || "Loading…"}</strong>
        {clientId
          ? " — obtain their consent before saving a card."
          : " — your card guarantees this booking, including bookings for someone else."}
      </p>
      <label>
        Card for your guarantee
        <select
          disabled={busy}
          value={choice}
          onChange={(e) => {
            const next = e.target.value;
            started.current = false;
            setRetryCheck(false);
            setChoice(next);
            setSetup("");
            setReady(false);
            card.current?.destroy();
            card.current = null;
            onChange(next === "new" ? "" : next, consent);
          }}
        >
          <option value="">Select a card option</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand}{" "}
              {c.last_four ? "•••• " + c.last_four : "— saved Sandbox card"}
            </option>
          ))}
          <option value="new">Add a new card</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => {
            setConsent(e.target.checked);
            onChange(choice === "new" ? "" : choice, e.target.checked);
          }}
        />
        {clientId ? "The client agrees" : "I agree"} to save this card and allow
        a €10 no-show charge for this booking. This is a Sandbox test.
      </label>
      {choice === "new" && (
        <>
          <label>
            Cardholder full name
            <input
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              autoComplete="cc-name"
            />
          </label>
          {!ready && started.current && !busy && (
            <button
              type="button"
              className="primary"
              disabled={!consent || busy}
              onClick={() => void start()}
            >
              Retry card setup
            </button>
          )}
        </>
      )}
      <div ref={target} />
      {ready && choice === "new" && (
        <button
          type="button"
          className="primary"
          disabled={!consent || busy}
          onClick={() => {
            if (name.trim().split(/\s+/).length < 2) {
              setMessage("Enter the cardholder’s first and last name.");
              return;
            }
            setBusy(true);
            try {
              card.current?.submit({
                name: name.trim(),
                email: owner.email,
                savePaymentMethodFor: "merchant",
              });
            } catch (e) {
              setMessage(String(e));
              setBusy(false);
            }
          }}
        >
          Save guarantee card
        </button>
      )}
      {setup && choice === "new" && retryCheck && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => verify())}
        >
          Check card again
        </button>
      )}
      <p role="status">{busy ? "Contacting Revolut Sandbox…" : message}</p>
    </div>
  );
}
