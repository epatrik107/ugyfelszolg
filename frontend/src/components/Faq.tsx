export function Faq({ items }: { items: { question: string; answer: string }[] }) {
  return <div className="space-y-5">{items.map((item) => <section key={item.question} className="space-y-2">
    <h3 className="text-lg font-semibold">{item.question}</h3>
    <p className="leading-7 text-slate-600">{item.answer}</p>
  </section>)}</div>;
}
