import { requireRole } from "@/lib/api/helpers";

// Math/chemistry notation: inline math in $...$, block math in $$...$$,
// chemistry in \ce{...} with NO dollar signs. Backslashes are doubled here
// only because this is a JS template literal — the emitted CSV has single
// backslashes. Keep in sync with MATH_CHEM_NOTATION_GUIDE.
//
// Rows are grouped into labeled sections so faculty can see worked examples
// per subject area. CSV has no real header/comment syntax, so each section
// marker is a normal data row with the label in question_text and marks left
// blank — the parser requires a positive marks value, so parseImportCsv /
// parseMarks (src/lib/qbank/parser.ts) skips it as an invalid row (reported
// in the import "errors" list) rather than inserting it as a question. This
// keeps the grouping visible in the raw file and in spreadsheet apps without
// disrupting a real re-import of this same file.
const SAMPLE_CSV = `question_text,question_type,marks,model_answer,option_a,option_b,option_c,option_d,correct_option,co_code,btl_level,module_name,difficulty
"### General — sample questions ###",,,,,,,,,,,,
"What is the time complexity of Binary Search?",mcq,1,"O(log n)","O(n)","O(log n)","O(n log n)","O(1)",B,CO1,2,Searching Algorithms,easy
"Explain the working of Merge Sort with an example.",short_answer,3,"Merge sort divides array into halves recursively then merges them in sorted order.",,,,,,CO2,3,Divide and Conquer,medium
"Design an efficient algorithm to find the shortest path between two nodes. Justify your choice of algorithm and analyze its time complexity.",long_answer,7,"Use Dijkstra's algorithm for non-negative weights. Time complexity O((V+E)logV) using min-heap.",,,,,,CO4,4,Graph Algorithms,hard
"### Mathematics — sample questions ###",,,,,,,,,,,,
"What is the value of $\\int_0^1 x^2\\,dx$?",mcq,1,"1/3","1/3","1/2","1","2",A,CO1,3,Integral Calculus,medium
"Solve the quadratic equation $x^2 - 5x + 6 = 0$ using the quadratic formula $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$.",short_answer,2,"$x = 2$ or $x = 3$",,,,,,CO2,3,Quadratic Equations,medium
"A projectile is launched with speed $v_0$ at angle $\\theta$. Show that its range is $$R = \\frac{v_0^2 \\sin(2\\theta)}{g}$$.",long_answer,5,"From the kinematic equations the horizontal range is $R = \\frac{v_0^2 \\sin(2\\theta)}{g}$, maximised at $\\theta = 45^\\circ$.",,,,,,CO3,4,Kinematics,medium
"### Chemistry — sample questions ###",,,,,,,,,,,,
"Which equation correctly balances the reaction \\ce{N2 + H2 -> NH3}?",mcq,1,"\\ce{N2 + 3H2 -> 2NH3}","\\ce{N2 + H2 -> NH3}","\\ce{N2 + 3H2 -> 2NH3}","\\ce{2N2 + H2 -> NH3}","\\ce{N2 + 2H2 -> NH3}",B,CO1,2,Chemical Equilibrium,easy
"Balance the combustion of propane \\ce{C3H8 + O2 -> CO2 + H2O} and give the mole ratio of propane to oxygen.",short_answer,3,"Balanced: \\ce{C3H8 + 5O2 -> 3CO2 + 4H2O}. The mole ratio of \\ce{C3H8} to \\ce{O2} is 1:5.",,,,,,CO2,3,Stoichiometry,medium
"### Note: diagram-based or structurally-drawn questions (skeletal chemistry structures, geometric figures, graphs) are NOT supported via CSV text. Add those through the Single or Bulk Images upload tabs instead. ###",,,,,,,,,,,,
`;

export async function GET() {
  const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
  if (authResult instanceof Response) return authResult;

  return new Response(SAMPLE_CSV, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="qbank_import_template.csv"',
    },
  });
}
