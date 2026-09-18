import type { OrderRow } from "../../src/lib/types";

/** Entirely fictional; preserves the failure's structure without customer data. */
export const rentalSource = {
  name: "Minta Anna", recipient: "Teszt Bérlő", letter_type: "Fizetési felszólítás",
  tone: "Határozott", selected_package: "basic", previous_messages: null, generated_letter: null,
  problem_description: "A bérlő három hónapja nem fizeti a bérleti díjat. Többször kértem szóban és írásban, de nem válaszolt. Nem érem el, és zárcserével kizárt a lakásból. Ez az utolsó felszólításom, mielőtt jogi útra lépek.",
  desired_result: "Fizesse ki az elmaradt bérleti díjat, utána bontsuk fel a szerződést és költözzön ki a lakásból.",
} as OrderRow;

export const validRentalLetter = `Tárgy: Az elmaradt bérleti díj rendezése

Tisztelt Teszt Bérlő!

Három hónapja nem fizeti a bérleti díjat. Korábbi szóbeli és írásbeli megkereséseimre nem kaptam választ, és jelenleg nem tudom elérni Önt. A zárcsere miatt nem tudok bejutni a lakásba.

Kérem az elmaradt bérleti díj rendezését, továbbá a bérleti szerződés lezárásáról és a lakás átadásáról való egyeztetést. Kérem, vegye fel velem a kapcsolatot az ügy rendezése érdekében.

Üdvözlettel:
Minta Anna`;
