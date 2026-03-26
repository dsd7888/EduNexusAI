export function getBranchFallbackSyllabus(branch: string): string {
  const fallbacks: Record<string, string> = {
    Mechanical:
      "Thermodynamics (laws, cycles, heat transfer), Fluid Mechanics (Bernoulli, flow types), Strength of Materials (stress, strain, beams), Manufacturing Processes, Engineering Mechanics (statics, dynamics)",
    Chemical:
      "Chemical Reaction Engineering, Mass Transfer, Heat Transfer, Thermodynamics, Process Control, Fluid Mechanics, Material and Energy Balances",
    "Computer Science":
      "Data Structures (arrays, trees, graphs), Algorithms (sorting, searching, complexity), Operating Systems, DBMS, Computer Networks, Object-Oriented Programming",
    Electronics:
      "Electronic Devices, Digital Logic, Signals and Systems, Control Systems, Communication Systems, Microprocessors",
    Electrical:
      "Circuit Analysis, Electrical Machines, Power Systems, Control Systems, Signals and Systems, Electromagnetic Theory",
    Civil:
      "Structural Analysis, Concrete Structures, Soil Mechanics, Fluid Mechanics, Transportation Engineering, Environmental Engineering",
    "Information Technology":
      "Data Structures, Algorithms, Database Management, Computer Networks, Software Engineering, Web Technologies",
  };

  return (
    fallbacks[branch] ??
    "Engineering Mathematics, Engineering Physics, Basic Electronics, Programming Fundamentals, Engineering Drawing"
  );
}

