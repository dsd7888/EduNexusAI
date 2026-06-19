import { requireRole } from "@/lib/api/helpers";

const SAMPLE_CSV = `question_text,question_type,marks,model_answer,option_a,option_b,option_c,option_d,correct_option,co_code,btl_level,module_name,difficulty
"What is the time complexity of Binary Search?",mcq,1,"O(log n)","O(n)","O(log n)","O(n log n)","O(1)",B,CO1,2,Searching Algorithms,easy
"Explain the working of Merge Sort with an example.",short_answer,3,"Merge sort divides array into halves recursively then merges them in sorted order.",,,,,,CO2,3,Divide and Conquer,medium
"Design an efficient algorithm to find the shortest path between two nodes. Justify your choice of algorithm and analyze its time complexity.",long_answer,7,"Use Dijkstra's algorithm for non-negative weights. Time complexity O((V+E)logV) using min-heap.",,,,,,CO4,4,Graph Algorithms,hard
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
