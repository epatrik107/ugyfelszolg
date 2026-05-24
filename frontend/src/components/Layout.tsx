import { FileText, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { LegalNotice } from "./LegalNotice";

const links = [
  { to: "/", label: "Főoldal" },
  { to: "/level-keszites", label: "Levélkészítés" },
  { to: "/arak", label: "Árak" },
  { to: "/kapcsolat", label: "Kapcsolat" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-navy-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link className="flex items-center gap-3 font-semibold" to="/">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-navy-900 text-white">
              <FileText size={20} />
            </span>
            <span className="text-lg">Ügyfélszolgálat</span>
          </Link>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 md:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Menü megnyitása"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <nav className="hidden items-center gap-6 text-sm md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  isActive ? "font-semibold text-azure-600" : "text-slate-600"
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        {open && (
          <nav className="grid gap-1 border-t border-slate-200 px-4 py-3 md:hidden">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm ${
                    isActive ? "bg-azure-100 font-semibold text-azure-600" : "text-slate-700"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="mt-16 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-3">
            <div className="font-semibold">Ügyfélszolgálat</div>
            <LegalNotice compact />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            <Link to="/aszf">ÁSZF</Link>
            <Link to="/adatkezeles">Adatkezelés</Link>
            <Link to="/kapcsolat">Kapcsolat</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
