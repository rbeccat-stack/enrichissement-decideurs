import { NextResponse } from "next/server";

const CONTACTS = [
  { firstName: "Marie", lastName: "Dupont", role: "Directrice Générale", email: "marie.dupont@exemple.fr", linkedin_url: "https://www.linkedin.com/in/marie-dupont", email_test_result: "Safe to Send" },
  { firstName: "Julien", lastName: "Martin", role: "DAF", email: "j.martin@exemple.fr", linkedin_url: null, email_test_result: "Risky" },
  { firstName: "Sophie", lastName: "Bernard", role: "Directrice Marketing", email: null, linkedin_url: "https://www.linkedin.com/in/sophie-bernard", email_test_result: null },
  { firstName: "Karim", lastName: "Benali", role: "CTO", email: "karim@exemple.fr", linkedin_url: "https://www.linkedin.com/in/karim-benali", email_test_result: "Invalid" },
];

export async function POST(req: Request) {
  const { siren, format } = await req.json();
  await new Promise((r) => setTimeout(r, 2500));
  if (siren === "000000000") return NextResponse.json([]);
  if (siren === "500000000") return new NextResponse("boom", { status: 500 });
  if (format === "csv") {
    const header = "firstName,lastName,role,email,linkedin_url,email_test_result";
    const rows = CONTACTS.map((c) => [c.firstName, c.lastName, c.role, c.email ?? "", c.linkedin_url ?? "", c.email_test_result ?? ""].join(","));
    return new NextResponse([header, ...rows].join("\n"), { headers: { "Content-Type": "text/csv" } });
  }
  return NextResponse.json(CONTACTS);
}
