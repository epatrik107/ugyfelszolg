import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { letterTypes, tones, packages } from "../lib/constants";
import type { LetterFormValues, PackageId } from "../lib/types";
import { PackageCard } from "./PackageCard";

export const initialLetterValues: LetterFormValues = {
  name: "", email: "", letterType: "Panaszlevél", recipient: "",
  problemDescription: "", desiredResult: "", tone: "Udvarias", previousMessages: "",
  selectedPackage: "basic", checkoutAttemptId: "",
  billing: { buyerType: "individual", name: "", email: "", country: "HU", postalCode: "", city: "", addressLine1: "" },
  legalAccepted: false, turnstileToken: "", demoAccessCode: "",
};

const cases = [
  { id: "delivery", label: "Nem érkezett meg a csomag", type: "Webáruházas probléma", recipient: "Webáruház neve", hint: "Mikor rendelte meg? Mikorra ígérték? Mit válaszolt a webáruház?", example: "Például: szeptember 2-án rendeltem egy lámpát. Öt napos szállítást ígértek, de még nem kaptam meg.", result: "Például: kérem a csomag kézbesítését vagy a vételár visszatérítését." },
  { id: "invoice", label: "Hibás számlát kaptam", type: "Reklamáció", recipient: "Számlát kiállító szolgáltató", hint: "Melyik számla hibás? Mi szerepel rajta, és minek kellene szerepelnie?", example: "Például: a szeptemberi számlán kétszer szerepel ugyanaz a szolgáltatási díj.", result: "Például: kérem a számla javítását és a tévesen felszámított összeg rendezését." },
  { id: "service", label: "Nem válaszol a szolgáltató", type: "Szolgáltatói vita", recipient: "Szolgáltató neve", hint: "Milyen ügyben kereste? Mikor és hogyan jelezte a problémát?", example: "Például: két hete emailben jeleztem a szolgáltatás hibáját, de azóta nem kaptam választ.", result: "Például: kérem a panasz kivizsgálását és írásbeli tájékoztatást a megoldásról." },
  { id: "other", label: "Más ügyben írok", type: "Panaszlevél", recipient: "Címzett neve", hint: "Írja le a történteket időrendben. Csak az ismert adatokat adja meg.", example: "Mi történt, mikor történt, és miért szeretne levelet írni?", result: "Milyen konkrét intézkedést vagy választ szeretne kérni?" },
];
const steps = ["Mi történt?", "Mit szeretne elérni?", "Ellenőrzés és fizetés"];
type Errors = Record<string, string>;

export function LetterForm({ busy = false, submitLabel, onSubmit }: {
  busy?: boolean; submitLabel: string; onSubmit: (values: LetterFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<LetterFormValues>(() => ({ ...initialLetterValues, billing: { ...initialLetterValues.billing }, checkoutAttemptId: crypto.randomUUID() }));
  const [step, setStep] = useState(0);
  const [caseId, setCaseId] = useState("other");
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const selectedCase = cases.find((item) => item.id === caseId)!;

  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
    moved.current = true;
  }, [step]);
  useEffect(() => {
    if (Object.keys(errors).length) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function update<K extends keyof LetterFormValues>(key: K, value: LetterFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }
  function updateBilling(key: "name" | "email" | "postalCode" | "city" | "addressLine1", value: string) {
    setValues((current) => ({ ...current, billing: { ...current.billing, [key]: value } }));
    setErrors((current) => { const next = { ...current }; delete next[`billing.${key}`]; return next; });
  }
  function fieldProps(id: string) {
    return { id, "aria-invalid": !!errors[id], "aria-describedby": errors[id] ? `${id}-error` : undefined };
  }
  function validate(currentStep: number): Errors {
    const next: Errors = {};
    const min = (id: string, value: string, length: number, message: string) => { if (value.trim().length < length) next[id] = message; };
    const email = (id: string, value: string) => { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) next[id] = "Adjon meg érvényes emailcímet, például nev@pelda.hu."; };
    if (currentStep === 0) {
      min("recipient", values.recipient, 2, "Adja meg a címzett nevét, legalább 2 karakterrel.");
      min("problemDescription", values.problemDescription, 30, "Írja le a történteket legalább 30 karakterrel, hogy legyen miből dolgoznunk.");
    }
    if (currentStep === 1) {
      min("desiredResult", values.desiredResult, 10, "Írja le legalább 10 karakterrel, milyen megoldást kér.");
      min("name", values.name, 2, "Adja meg a levélben szereplő nevét, legalább 2 karakterrel.");
      email("email", values.email);
    }
    if (currentStep === 2) {
      min("billing.name", values.billing.name, 2, "Adja meg a számlázási nevet, legalább 2 karakterrel.");
      email("billing.email", values.billing.email);
      if (!/^\d{4}$/.test(values.billing.postalCode.trim())) next["billing.postalCode"] = "Az irányítószám 4 számjegy legyen.";
      min("billing.city", values.billing.city, 2, "Adja meg a település nevét, legalább 2 karakterrel.");
      min("billing.addressLine1", values.billing.addressLine1, 3, "Adja meg a közterület nevét és a házszámot.");
      if (!values.legalAccepted) next.legalAccepted = "A folytatáshoz olvassa el és fogadja el a feltételeket.";
    }
    return next;
  }
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next = validate(step);
    setErrors(next);
    if (Object.keys(next).length) return;
    if (step < 2) {
      if (step === 1) setValues((current) => ({ ...current, billing: { ...current.billing, name: current.billing.name || current.name, email: current.billing.email || current.email } }));
      setStep(step + 1);
    } else {
      try { await onSubmit(values); }
      catch { setErrors({ submit: "Nem sikerült megnyitni az összegzést. Az adatai megmaradtak; próbálja újra." }); }
    }
  }

  return (
    <form ref={formRef} className="space-y-6" onSubmit={handleSubmit} noValidate>
      <ol aria-label="A levélkészítés lépései" className="grid grid-cols-3 gap-2">
        {steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={`rounded-xl border p-3 text-sm ${index === step ? "border-azure-600 bg-azure-50 text-navy-900" : "border-slate-200 text-slate-600"}`}>
          <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white font-semibold" aria-hidden="true">{index < step ? <Check size={16} /> : index + 1}</span>
          <span className="font-medium">{label}</span>
        </li>)}
      </ol>
      <div>
        <p className="text-sm text-slate-500">{step + 1}. lépés a 3-ból</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold outline-none">{steps[step]}</h2>
      </div>

      <fieldset hidden={step !== 0} disabled={busy} className="space-y-5">
        <legend className="sr-only">Az ügy részletei</legend>
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Ügy kiválasztása">
          {cases.map((item) => <button key={item.id} type="button" aria-pressed={caseId === item.id} onClick={() => { setCaseId(item.id); update("letterType", item.type); }} className={`rounded-xl border p-4 text-left font-medium transition ${caseId === item.id ? "border-azure-600 bg-azure-50" : "border-slate-200 bg-white hover:border-azure-400"}`}>{item.label}</button>)}
        </div>
        {caseId === "other" && <Field label="Levél típusa" id="letterType"><select {...fieldProps("letterType")} className="input" value={values.letterType} onChange={(event) => update("letterType", event.target.value)}>{letterTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>}
        <Field label={selectedCase.recipient} id="recipient" error={errors.recipient}>
          <input {...fieldProps("recipient")} className="input" maxLength={180} placeholder="Kinek címezzük a levelet?" value={values.recipient} onChange={(event) => update("recipient", event.target.value)} />
        </Field>
        <Field label="Mi történt pontosan?" id="problemDescription" error={errors.problemDescription}>
          <p className="text-sm font-normal text-slate-600">{selectedCase.hint} Amit nem tud, hagyja ki.</p>
          <textarea {...fieldProps("problemDescription")} className="input min-h-40" maxLength={3000} placeholder={selectedCase.example} value={values.problemDescription} onChange={(event) => update("problemDescription", event.target.value)} />
          <span className="text-xs font-normal text-slate-500">{values.problemDescription.length}/3000 karakter · legalább 30</span>
        </Field>
        <Field label="Korábbi levelezés (nem kötelező)" id="previousMessages">
          <textarea {...fieldProps("previousMessages")} className="input min-h-24" maxLength={3000} placeholder="Ha már írt a címzettnek, ide bemásolhatja a fontos részleteket." value={values.previousMessages} onChange={(event) => update("previousMessages", event.target.value)} />
        </Field>
      </fieldset>

      <fieldset hidden={step !== 1} disabled={busy} className="space-y-5">
        <legend className="sr-only">A kívánt megoldás és az Ön adatai</legend>
        <Field label="Milyen megoldást kér?" id="desiredResult" error={errors.desiredResult}>
          <textarea {...fieldProps("desiredResult")} className="input min-h-28" maxLength={1200} placeholder={selectedCase.result} value={values.desiredResult} onChange={(event) => update("desiredResult", event.target.value)} />
        </Field>
        <Field label="A levél hangneme" id="tone"><select {...fieldProps("tone")} className="input" value={values.tone} onChange={(event) => update("tone", event.target.value)}>{tones.map((tone) => <option key={tone}>{tone}</option>)}</select></Field>
        <Field label="Az Ön neve" id="name" error={errors.name}><input {...fieldProps("name")} className="input" autoComplete="name" maxLength={120} placeholder="A levél aláírójának neve" value={values.name} onChange={(event) => update("name", event.target.value)} /></Field>
        <Field label="Emailcím a visszaigazoláshoz" id="email" error={errors.email}><input {...fieldProps("email")} className="input" autoComplete="email" maxLength={254} type="email" placeholder="nev@pelda.hu" value={values.email} onChange={(event) => update("email", event.target.value)} /></Field>
      </fieldset>

      <fieldset hidden={step !== 2} disabled={busy} className="space-y-6">
        <legend className="sr-only">Csomag, számlázás és feltételek</legend>
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Csomag kiválasztása</h3>
          <div className="grid gap-3 xl:grid-cols-3">{(["basic", "premium", "premium_plus"] as PackageId[]).map((packageId) => <PackageCard key={packageId} packageId={packageId} selected={values.selectedPackage === packageId} onSelect={(value) => update("selectedPackage", value)} />)}</div>
          <p className="rounded-lg bg-azure-50 p-4 text-sm"><strong>{packages[values.selectedPackage].price}, egyszeri fizetés.</strong> Egy elkészült levél, másolás és letöltés, valamint {packages[values.selectedPackage].maxRegenerations} AI-módosítás. A kézi szerkesztés nem fogyasztja a keretet.</p>
        </section>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-lg font-semibold">Számlázási adatok</h3>
          <p className="text-sm text-slate-600">Magánszemély részére kiállított számla. A nevet és emailcímet előkészítettük; szükség esetén javíthatja.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Számlázási név" id="billing.name" error={errors["billing.name"]}><input {...fieldProps("billing.name")} className="input" autoComplete="billing name" maxLength={120} value={values.billing.name} onChange={(event) => updateBilling("name", event.target.value)} /></Field>
            <Field label="Számlázási email" id="billing.email" error={errors["billing.email"]}><input {...fieldProps("billing.email")} className="input" type="email" autoComplete="billing email" maxLength={254} value={values.billing.email} onChange={(event) => updateBilling("email", event.target.value)} /></Field>
            <Field label="Irányítószám" id="billing.postalCode" error={errors["billing.postalCode"]}><input {...fieldProps("billing.postalCode")} className="input" inputMode="numeric" autoComplete="billing postal-code" maxLength={4} value={values.billing.postalCode} onChange={(event) => updateBilling("postalCode", event.target.value)} /></Field>
            <Field label="Település" id="billing.city" error={errors["billing.city"]}><input {...fieldProps("billing.city")} className="input" autoComplete="billing address-level2" maxLength={100} value={values.billing.city} onChange={(event) => updateBilling("city", event.target.value)} /></Field>
          </div>
          <Field label="Közterület és házszám" id="billing.addressLine1" error={errors["billing.addressLine1"]}><input {...fieldProps("billing.addressLine1")} className="input" autoComplete="billing address-line1" maxLength={180} value={values.billing.addressLine1} onChange={(event) => updateBilling("addressLine1", event.target.value)} /></Field>
          <p className="text-sm text-slate-500">Ország: Magyarország</p>
        </section>
        <div>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-700">
            <input {...fieldProps("legalAccepted")} checked={values.legalAccepted} className="mt-1 h-5 w-5 shrink-0 accent-navy-900" type="checkbox" onChange={(event) => update("legalAccepted", event.target.checked)} />
            <span>Elfogadom, hogy a szolgáltatás nem minősül jogi tanácsadásnak, az elkészült szöveget saját felelősségemre használom fel. Elolvastam és elfogadom az <Link to="/aszf" className="underline" target="_blank" rel="noopener noreferrer">Általános Szerződési Feltételeket</Link> és az <Link to="/adatkezeles" className="underline" target="_blank" rel="noopener noreferrer">Adatkezelési tájékoztatót</Link>. Kifejezetten kérem, hogy a digitális szolgáltatás teljesítése a sikeres fizetés után azonnal kezdődjön meg, és tudomásul veszem, hogy a teljesítés megkezdésével elveszítem a 14 napos elállási jogomat.</span>
          </label>
          {errors.legalAccepted && <p id="legalAccepted-error" className="mt-2 text-sm text-rose-700">{errors.legalAccepted}</p>}
        </div>
      </fieldset>
      {Object.keys(errors).length > 0 && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errors.submit || "Kérjük, javítsa a megjelölt mezőket. Az eddig megadott adatai megmaradtak."}</p>}
      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
        {step > 0 && <button className="button-secondary" type="button" disabled={busy} onClick={() => { setErrors({}); setStep(step - 1); }}><ArrowLeft size={18} /> Vissza</button>}
        <button className="button-primary sm:ml-auto" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowRight size={18} />}{step < 2 ? "Tovább" : submitLabel}</button>
      </div>
      <p className="text-center text-xs text-slate-500">{step === 2 ? "Az összegzés megnyitása még nem indít fizetést." : "Visszalépéskor megmaradnak a kitöltött adatok."}</p>
    </form>
  );
}

function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return <div className="grid gap-2 text-base font-medium text-slate-700"><label htmlFor={id}>{label}</label>{children}{error && <p id={`${id}-error`} className="text-sm font-normal text-rose-700">{error}</p>}</div>;
}
