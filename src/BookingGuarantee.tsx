import { isConnectionError, requestErrorMessage } from "./requestErrors";
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
  const [loadingCards, setLoadingCards] = useState(true), [cardLoadError, setCardLoadError] = useState(""), [cardListVersion, setCardListVersion] = useState(0);
  const started = useRef(false);
  const [retryCheck, setRetryCheck] = useState(false);
  const target = useRef<HTMLDivElement>(null),
    mounted = useRef(true);
  const card = useRef<ReturnType<
    Awaited<ReturnType<typeof RevolutCheckout>>["createCardField"]
  > | null>(null);
  async function call(action: string, extra: Record<string, unknown> = {}, signal?: AbortSignal) {
    const { data, error } = await db.functions.invoke("booking-guarantee", {
      body: { action, client_id: clientId, ...extra },
      ...(action === "list" ? {timeout:15000,signal} : {}),
    });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || (isConnectionError(error) ? "Network error" : error.message));
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
        setMessage(requestErrorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    onChange("", false);
    const controller = new AbortController();
    let active = true;
    setLoadingCards(true);setCardLoadError("");setCards([]);setChoice("");setOwner({name:"",email:""});
    void (async()=>{
      try {
        let data;
        for(let attempt=0;attempt<2;attempt++) {
          try {data=await call("list",{},controller.signal);break;}
          catch(e) {if(!active || !isConnectionError(e) || attempt===1)throw e;}
        }
        if(!active || !data)return;
        setCards(data.cards);setOwner({name:data.owner_name,email:data.owner_email});setName(data.owner_name);
        const next=data.cards[0]?.id || "new";setChoice(next);onChange(next === "new" ? "" : next,false);
      } catch(e) {if(active)setCardLoadError(requestErrorMessage(e,"We couldn’t load your saved cards."));}
      finally {if(active)setLoadingCards(false);}
    })();
    return () => {
      active=false;controller.abort();
      mounted.current = false;
      card.current?.destroy();
    };
  }, [clientId, db, cardListVersion]);
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
            setMessage(requestErrorMessage(error));
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
        Guarantee card owner: <strong>{owner.name || (loadingCards ? "Loading…" : "Unavailable")}</strong>
        {clientId
          ? " — obtain their consent before saving a card."
          : " — your card guarantees this booking, including bookings for someone else."}
      </p>
      <label>
        Card for your guarantee
        <select
          disabled={busy || loadingCards || !!cardLoadError}
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
          <option value="">{loadingCards ? "Loading saved cards…" : cardLoadError ? "Saved cards unavailable — retry below" : "Select a card option"}</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand}{" "}
              {c.last_four ? "•••• " + c.last_four : "— saved Sandbox card"}
            </option>
          ))}
          <option value="new">Add a new card</option>
        </select>
      </label>
      {loadingCards && <p role="status">Loading your saved cards. Please wait before choosing a card.</p>}
      {cardLoadError && <div role="alert"><p>{cardLoadError}</p><button type="button" className="secondary" onClick={()=>setCardListVersion(v=>v+1)}>Retry loading saved cards</button></div>}
      {!loadingCards && !cardLoadError && cards.length===0 && <p className="small">You have no saved cards yet. Add a new card below.</p>}
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || loadingCards || !!cardLoadError}
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
              setMessage(requestErrorMessage(e));
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
