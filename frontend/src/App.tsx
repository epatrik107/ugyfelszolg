import { Component, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CancelPage } from "./pages/CancelPage";
import { ContactPage } from "./pages/ContactPage";
import { HomePage } from "./pages/HomePage";
import { LetterCreationPage } from "./pages/LetterCreationPage";
import { PricingPage } from "./pages/PricingPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { SuccessPage } from "./pages/SuccessPage";
import { TermsPage } from "./pages/TermsPage";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-slate-800">Váratlan hiba történt.</p>
          <button
            className="button-secondary"
            onClick={() => window.location.reload()}
          >
            Oldal újratöltése
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/level-keszites" element={<LetterCreationPage />} />
          <Route path="/arak" element={<PricingPage />} />
          <Route path="/sikeres-fizetes" element={<SuccessPage />} />
          <Route path="/sikertelen-fizetes" element={<CancelPage />} />
          <Route path="/kapcsolat" element={<ContactPage />} />
          <Route path="/aszf" element={<TermsPage />} />
          <Route path="/adatkezeles" element={<PrivacyPage />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
