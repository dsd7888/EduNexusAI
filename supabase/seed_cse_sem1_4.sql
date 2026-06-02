-- ============================================================================
-- seed_cse_sem1_4.sql
-- P. P. Savani University | School of Engineering
-- Computer Science and Engineering — Semesters 1 to 4 syllabus seed
--
-- Semester is taken from the source document grouping (Sem1.pdf .. Sem4.pdf).
-- branch is 'Computer Science and Engineering' for every subject per spec.
--
-- NOTE (CO-PO / CO-PSO alignment): the original PDF mapping matrices lost their
-- column alignment during PDF->text extraction (sparse cells collapsed). Strength
-- values are therefore assigned to CONSECUTIVE PO/PSO columns starting at PO1/PSO1.
-- This preserves every strength value but the exact PO/PSO column may need
-- verification against the original PDF before use for accreditation analytics.
--
-- NOTE (tutorials): subjects with a "List of Tutorial" (no practicals) store that
-- per-item list in subject_content.practicals (schema has no separate tutorial field).
--
-- NOTE (BTL): for 4 subjects the source BTL table topics did not align 1:1 with the
-- module list; btl_levels were mapped by module name/topic and flagged inline.
-- ============================================================================

BEGIN;

-- ================================================================
-- Subject: SESH1070 | Fundamentals of Mathematics | Sem 1 | 4 modules | 5 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Fundamentals of Mathematics', 'SESH1070', 'Engineering', 'Computer Science and Engineering', 1);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH1070 - Fundamentals of Mathematics\n\n'
    || E'Module 1: Calculus\nLimits, Continuity, Types of Discontinuity, Successive Differentiation, Rolle''s Theorem, LMVT, CMVT, Maxima and Minima.\n\n'
    || E'Module 2: Sequence and Series-I\nConvergence and Divergence, Comparison Test, Integral Test, Ratio Test, Root Test, Alternating Series, Absolute and Conditional Convergence.\n\n'
    || E'Module 3: Sequence and Series-II\nPower series, Taylor and Macluarin series, Indeterminate forms and L''Hospitals Rule.\n\n'
    || E'Module 4: Matrix Algebra\nElementary Row and Column operations, Inverse of matrix, Rank of matrix, System of Linear Equations, Characteristic Equation, Eigen values and Eigen vector, Diagonalization, Cayley Hamilton Theorem, Orthogonal Transformation.',
    E'Textbooks:\nThomas'' Calculus — George B. Thomas, Maurice D. Weir & Joel Hass — Pearson\nElementary linear Algebra — Howard Anton and Chrish Rorres — Wiley\n\nReference Books:\nAdvanced Engineering Mathematics — E Kreyszig — John Wiley and Sons\nA textbook of Engineering Mathematics — N P Bali and Manish Goyal — Laxmi\nHigher Engineering Mathematics — B S Grewal — Khanna\nEngineering Mathematics for First Year — T Veerarajan — Tata Mc Graw Hill\nEngineering Mathematics-1 (Calculus) — H. K. Dass, Dr. Rama Verma — S. Chand',
    '[{"sr_no":1,"name":"Calculus-1","hours":4},{"sr_no":2,"name":"Calculus-2","hours":2},{"sr_no":3,"name":"Integration","hours":4},{"sr_no":4,"name":"Sequence and Series-1","hours":4},{"sr_no":5,"name":"Sequence and Series-2","hours":4},{"sr_no":6,"name":"Sequence and Series-3","hours":2},{"sr_no":7,"name":"Matrix Algebra-1","hours":4},{"sr_no":8,"name":"Matrix Algebra-2","hours":2},{"sr_no":9,"name":"Matrix Algebra-3","hours":2},{"sr_no":10,"name":"Matrix Algebra-4","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Calculus', 1, 'Limits, Continuity, Types of Discontinuity, Successive Differentiation, Rolle''s Theorem, LMVT, CMVT, Maxima and Minima.', 8, 28, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Sequence and Series-I', 2, 'Convergence and Divergence, Comparison Test, Integral Test, Ratio Test, Root Test, Alternating Series, Absolute and Conditional Convergence.', 7, 22, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Sequence and Series-II', 3, 'Power series, Taylor and Macluarin series, Indeterminate forms and L''Hospitals Rule.', 6, 20, 2, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Matrix Algebra', 4, 'Elementary Row and Column operations, Inverse of matrix, Rank of matrix, System of Linear Equations, Characteristic Equation, Eigen values and Eigen vector, Diagonalization, Cayley Hamilton Theorem, Orthogonal Transformation.', 9, 30, 2, ARRAY['1','2','3','4']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'To recall the concepts of limit, continuity and differentiability for analysing mathematical problems.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Explain concepts of limit, derivatives and integrals.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Analyze the series for its convergence and divergence to slove real world problems.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Evaluate linear system using matrices.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Adapt the knowledge of eigenvalues and eigenvectors for matrix diagonalization.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 1);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, NULL, NULL, 50, 150, 4);
END $$;

-- ================================================================
-- Subject: SECV1040 | Basics of Civil & Mechanical Engineering | Sem 1 | 9 modules | 4 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Basics of Civil & Mechanical Engineering', 'SECV1040', 'Engineering', 'Computer Science and Engineering', 1);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECV1040 - Basics of Civil & Mechanical Engineering\n\n'
    || E'Module 1: Civil Engineering: An Overview\nIntroduction, Branches, Scope, Impact, Role of Civil Engineer, Unit of Measurement, Unit Conversion (Length, Area, Volume).\n\n'
    || E'Module 2: Introduction to Surveying and Levelling\nIntroduction, Fundamental Principles, Classification. Linear Measurement: Instrument Used, Chaining on Plane Ground, Offset, Ranging. Angular Measurement: Instrument Used, Meridian, Bearing, Local Attraction. Levelling: Instrument Used, Basic Terminologies, Types of Levelling, Method of Levelling. Modern Tools: Introduction to Theodolite, Total Station, GPS.\n\n'
    || E'Module 3: Building Materials and Construction\nIntroduction (Types and Properties) to Construction Materials Like Stone, Bricks, Cement, Sand, Aggregates, Concrete, Steel. Classification of Buildings, Types of Loads Acting on Buildings, Building Components and their Functions, Types of Foundation and Importance, Symbols Used in Electrical Layout, Symbols Used for Water Supply, Plumbing and Sanitation.\n\n'
    || E'Module 4: Construction Equipment\nTypes of Equipment - Functions, Uses. Hauling Equipment - Truck, Dumper, Trailer. Hoisting Equipment - Pulley, Crane, Jack, Winch, Sheave Block, Fork Truck. Pneumatic Equipment - Compressor. Conveying Equipment - Package, Screw, Flight/scrap, Bucket, Belt Conveyor. Drill, Tractor, Ripper, Rim Pull, Dredger, Drag Line, Power Shovel, JCB, HOE.\n\n'
    || E'Module 5: Recent Trends in Civil Engineering\nMass Transportation, Rapid Transportation, Smart City, Sky Scarper, Dams, Rain Water Harvesting, Batch Mix Plant, Ready Mix Concrete Plant, Green Building, Earth Quake Resisting Building, Smart Material.\n\n'
    || E'Module 6: Basic Concepts of Thermodynamics\nPrime Movers - Meaning and Classification; the Concept of Force, Pressure, Energy, Work, Power, System, Heat, Temperature, Specific Heat Capacity, Internal Energy, Specific Volume; Thermodynamic Systems, All Laws of Thermodynamics.\n\n'
    || E'Module 7: Fuels and Energy\nFuels Classification: Solid, Liquid and Gaseous; their Application. Energy Classification: Conventional and Non-Conventional Energy Sources, Introduction and Applications of Energy Sources like Fossil Fuels, Solar, Wind, and Bio-Fuels, LPG, CNG, Calorific Value.\n\n'
    || E'Module 8: Basics of I.C Engines\nConstruction and working of 2 Stroke & 4 Stroke Petrol and Diesel Engines, Difference Between 2-Stroke - 4 Stroke Engine & Petrol Diesel Engine, Efficiency of I. C. Engines.\n\n'
    || E'Module 9: Power Transmission Elements\nConstruction and Applications of Couplings, Clutches and Brakes, Difference Between Clutch and Coupling, Types of Belt Drive and Gear Drive.',
    E'Textbooks:\nElements of Mechanical Engineering Vol. I — S. B. Mathur, S. Domkundwar — Dhanpat Rai & Sons Publications\nElements of Mechanical Engineering — Sadhu Singh — S. Chand Publications\nElements of Civil Engineering — Anurag A. Kandya — Charotar Publication\nSurveying Vol. I & II — Dr. B. C. Punamia — Laxmi Publication\n\nReference Books:\nThermal Engineering — R. K. Rajput — Laxmi Publications\nBasic Mechanical Engineering — T.S. Rajan — Wiley Eastern Ltd., 1996\nSurveying and Levelling — N. N. Basak — Tata McGraw Hill\nSurveying Vol. I — S. K. Duggal — Tata McGraw Hill\nSurveying and Levelling — R. Subramanian — Oxford University\nBuilding Construction and Construction Material — G. S. Birdie and T. D. Ahuja — Dhanpat Rai Publishing\nEngineering Material — S.C. Rangwala — Charotar Publication',
    '[{"sr_no":1,"name":"Unit conversation Exercise and Chart preparation of building components","hours":2},{"sr_no":2,"name":"Linear measurements","hours":2},{"sr_no":3,"name":"Angular measurements","hours":2},{"sr_no":4,"name":"Determine R. L of given point by Dumpy level. (Without Change Point)","hours":2},{"sr_no":5,"name":"Determine R. L of given point by Dumpy level. (With Change Point)","hours":2},{"sr_no":6,"name":"Presentation on various topics as in module about recent trends","hours":4},{"sr_no":7,"name":"To understand construction and working of various types of boilers","hours":4},{"sr_no":8,"name":"To understand construction and working of mountings","hours":4},{"sr_no":9,"name":"To understand construction and working of accessories","hours":4},{"sr_no":10,"name":"To understand construction and working 2-stroke & 4-stroke Petrol Engines","hours":2},{"sr_no":11,"name":"To understand construction and working 2-stroke & 4-stroke Diesel Engines","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Civil Engineering: An Overview', 1, 'Introduction, Branches, Scope, Impact, Role of Civil Engineer, Unit of Measurement, Unit Conversion (Length, Area, Volume).', 3, 4, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Introduction to Surveying and Levelling', 2, 'Introduction, Fundamental Principles, Classification. Linear Measurement: Instrument Used, Chaining on Plane Ground, Offset, Ranging. Angular Measurement: Instrument Used, Meridian, Bearing, Local Attraction. Levelling: Instrument Used, Basic Terminologies, Types of Levelling, Method of Levelling. Modern Tools: Introduction to Theodolite, Total Station, GPS.', 7, 12, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Building Materials and Construction', 3, 'Introduction (Types and Properties) to Construction Materials Like Stone, Bricks, Cement, Sand, Aggregates, Concrete, Steel. Classification of Buildings, Types of Loads Acting on Buildings, Building Components and their Functions, Types of Foundation and Importance, Symbols Used in Electrical Layout, Symbols Used for Water Supply, Plumbing and Sanitation.', 10, 14, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Construction Equipment', 4, 'Types of Equipment - Functions, Uses. Hauling Equipment - Truck, Dumper, Trailer. Hoisting Equipment - Pulley, Crane, Jack, Winch, Sheave Block, Fork Truck. Pneumatic Equipment - Compressor. Conveying Equipment - Package, Screw, Flight/scrap, Bucket, Belt Conveyor. Drill, Tractor, Ripper, Rim Pull, Dredger, Drag Line, Power Shovel, JCB, HOE.', 4, 8, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Recent Trends in Civil Engineering', 5, 'Mass Transportation, Rapid Transportation, Smart City, Sky Scarper, Dams, Rain Water Harvesting, Batch Mix Plant, Ready Mix Concrete Plant, Green Building, Earth Quake Resisting Building, Smart Material.', 6, 12, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Basic Concepts of Thermodynamics', 6, 'Prime Movers - Meaning and Classification; the Concept of Force, Pressure, Energy, Work, Power, System, Heat, Temperature, Specific Heat Capacity, Internal Energy, Specific Volume; Thermodynamic Systems, All Laws of Thermodynamics.', 4, 8, 2, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Fuels and Energy', 7, 'Fuels Classification: Solid, Liquid and Gaseous; their Application. Energy Classification: Conventional and Non-Conventional Energy Sources, Introduction and Applications of Energy Sources like Fossil Fuels, Solar, Wind, and Bio-Fuels, LPG, CNG, Calorific Value.', 4, 8, 2, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Basics of I.C Engines', 8, 'Construction and working of 2 Stroke & 4 Stroke Petrol and Diesel Engines, Difference Between 2-Stroke - 4 Stroke Engine & Petrol Diesel Engine, Efficiency of I. C. Engines.', 12, 18, 2, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Power Transmission Elements', 9, 'Construction and Applications of Couplings, Clutches and Brakes, Difference Between Clutch and Coupling, Types of Belt Drive and Gear Drive.', 10, 16, 2, ARRAY['1','2']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Apply the principles of basic mechanical engineering.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Comprehend the importance of mechanical engineering equipment''s like ic engine and power transmission elements.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Understand different structural loads, components, materials and equipment''s used in the construction of a building.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Adapt various methods of area plotting and marking before starting the construction activity.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 5);
END $$;

-- ================================================================
-- Subject: SECE1050 | Programming for Problem Solving | Sem 1 | 9 modules | 4 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Programming for Problem Solving', 'SECE1050', 'Engineering', 'Computer Science and Engineering', 1);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE1050 - Programming for Problem Solving\n\n'
    || E'Module 1: Introduction to Computers\nIntroduction, Central Processing Unit, Main Memory Unit, Interconnection of Units, Communication between Units of a Computer System. Memory Representation and Hierarchy, Random Access Memory, Read-only Memory, Classification of Secondary Storage Devices, Types of I/O Devices. Classification of Programming Languages, Generations of Programming Languages - Machine Language, Assembly Language, High-Level Language, 4GL.\n\n'
    || E'Module 2: Introduction to C, Constants, Variables and Data Types\nFeatures of C Language, the Structure of C Program, Flow Charts and Algorithms Types of Errors, Debugging, Tracing the Execution of the Program, matching Variables Values in Memory. Character Set, C Tokens, Keyword and Identifiers, Constants and Variables, Data Types - Declaration and Initialization, User Define Type Declarations - Typedef, Enum, Basic Input, and Output Operations, Symbolic Constants, Overflow and Underflow of Data.\n\n'
    || E'Module 3: Operators, Expressions, and Managing I/O Operations\nIntroduction to Operators and its Types, Evaluation of Expressions, Precedence of Arithmetic Operators, Type Conversions in Expressions, Operator Precedence and Associatively. Introduction to Reading a Character, Writing a Character, Formatted Input and Output.\n\n'
    || E'Module 4: Conditional Statements\nDecision Making & Branching: Decision Making with If and If-else Statements, Nesting of If-else Statements, The Switch and go-to statements, Ternary (?:) Operator. Looping: The while Statement, The Break Statement & The Do.While loop, The FOR loop, Jump within loops - Programs.\n\n'
    || E'Module 5: Arrays\nIntroduction, One-dimensional Arrays, Two-dimensional Arrays, Concept of Multidimensional Arrays.\n\n'
    || E'Module 6: Strings\nDeclaring and Initializing String Variables, Arithmetic Operations on Characters, Putting Strings Together, Comparison of Two Strings, String Handling Functions.\n\n'
    || E'Module 7: User-Defined Functions\nConcepts of User-defined Functions, Prototypes, function Definition, Parameters, Parameter Passing, Calling a Function, Recursive Function, Macros and Macro Substitution.\n\n'
    || E'Module 8: Structure and Unions\nIntroduction, Structure Definition, Declaring and Initializing Structure Variables, Accessing Structure Members, Copying & Comparison of Structures, Arrays of Structures, Arrays within Structures, Structures within Structures, Structures and Functions, Unions.\n\n'
    || E'Module 9: Pointers and File Management\nBasics of Pointers, a Chain of Pointers, Pointer and Array, Pointer to an Array, an Array of Pointers, Pointers and Functions, Dynamic Memory Allocation. Introduction to file Management and its Functions.',
    E'Textbooks:\nProgramming in ANSI C — E. Balagurusamy — Tata McGraw Hill\nIntroduction to Computer Science — ITL Education Solutions Limited — Pearson Education\n\nReference Books:\nProgramming in C — Ashok Kamthane — Pearson\nLet Us C — Yashavant P. Kanetkar — Tata McGraw Hill\nIntroduction to C Programming — Reema Thareja — Oxford Higher Education\nProgramming with C — Byron Gottfried — Tata McGraw Hill',
    '[{"sr_no":1,"name":"Introduction to Unix Commands (creating a folder, creating a file, deleting a file, renaming files, copy a file from one location to another, listing entire directories and files, list directories, listing files, moving files from one location to another)","hours":2},{"sr_no":2,"name":"Introduction to C programming environment, compiler, Linker, loader, and editor.","hours":2},{"sr_no":3,"name":"Working with basic elements of C languages (different input functions, different output functions, different data types, and different operators)","hours":6},{"sr_no":4,"name":"Working with C control structures (if statement, if-else statement, nested if-else statement, switch statement, break statement, goto statement)","hours":6},{"sr_no":5,"name":"Working with C looping constructs (for loop, while loop, do-while and nested for loop)","hours":10},{"sr_no":6,"name":"Working with the array in C (1-D array, and 2-D array)","hours":4},{"sr_no":7,"name":"Working with strings in C (input, output, different string inbuilt functions)","hours":4},{"sr_no":8,"name":"Working with user-defined functions in C (function with/without return type, function with/without argument, function and array)","hours":6},{"sr_no":9,"name":"Working with recursive function in C","hours":2},{"sr_no":10,"name":"Working with structure and union in C (structure declaration, initialization, an array of structures, structure within structure, structure and functions, an array within structure and union)","hours":8},{"sr_no":11,"name":"Working with pointer in C (initialization, pointer to pointer, pointer and array, an array of pointer, pointer and function)","hours":6},{"sr_no":12,"name":"Working with files in C (opening a file, data insertion, and extraction from file, file management functions)","hours":4}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction to Computers', 1, 'Introduction, Central Processing Unit, Main Memory Unit, Interconnection of Units, Communication between Units of a Computer System. Memory Representation and Hierarchy, Random Access Memory, Read-only Memory, Classification of Secondary Storage Devices, Types of I/O Devices. Classification of Programming Languages, Generations of Programming Languages - Machine Language, Assembly Language, High-Level Language, 4GL.', 4, 10, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Introduction to C, Constants, Variables and Data Types', 2, 'Features of C Language, the Structure of C Program, Flow Charts and Algorithms Types of Errors, Debugging, Tracing the Execution of the Program, matching Variables Values in Memory. Character Set, C Tokens, Keyword and Identifiers, Constants and Variables, Data Types - Declaration and Initialization, User Define Type Declarations - Typedef, Enum, Basic Input, and Output Operations, Symbolic Constants, Overflow and Underflow of Data.', 6, 15, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Operators, Expressions, and Managing I/O Operations', 3, 'Introduction to Operators and its Types, Evaluation of Expressions, Precedence of Arithmetic Operators, Type Conversions in Expressions, Operator Precedence and Associatively. Introduction to Reading a Character, Writing a Character, Formatted Input and Output.', 5, 10, 1, ARRAY['3','4']),
   (gen_random_uuid(), subj_id, 'Conditional Statements', 4, 'Decision Making & Branching: Decision Making with If and If-else Statements, Nesting of If-else Statements, The Switch and go-to statements, Ternary (?:) Operator. Looping: The while Statement, The Break Statement & The Do.While loop, The FOR loop, Jump within loops - Programs.', 7, 15, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Arrays', 5, 'Introduction, One-dimensional Arrays, Two-dimensional Arrays, Concept of Multidimensional Arrays.', 5, 12, 2, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'Strings', 6, 'Declaring and Initializing String Variables, Arithmetic Operations on Characters, Putting Strings Together, Comparison of Two Strings, String Handling Functions.', 4, 10, 2, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'User-Defined Functions', 7, 'Concepts of User-defined Functions, Prototypes, function Definition, Parameters, Parameter Passing, Calling a Function, Recursive Function, Macros and Macro Substitution.', 4, 10, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Structure and Unions', 8, 'Introduction, Structure Definition, Declaring and Initializing Structure Variables, Accessing Structure Members, Copying & Comparison of Structures, Arrays of Structures, Arrays within Structures, Structures within Structures, Structures and Functions, Unions.', 4, 8, 2, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Pointers and File Management', 9, 'Basics of Pointers, a Chain of Pointers, Pointer and Array, Pointer to an Array, an Array of Pointers, Pointers and Functions, Dynamic Memory Allocation. Introduction to file Management and its Functions.', 6, 10, 2, ARRAY['2','3']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Observe and interpret the concepts for data representation, algorithms and coding methods in computer system.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Immediately analyze the syntax and semantics of the "c" language and apply in program.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Manage the less memory usage while developing the program.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Classify the types of errors occur while running the program.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 40, 60, NULL, 200, 5);
END $$;

-- ================================================================
-- Subject: SESH1240 | Electrical & Electronics Workshop | Sem 1 | 0 modules | 4 COs
-- NOTE: laboratory course — no theory modules (modules omitted).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Electrical & Electronics Workshop', 'SESH1240', 'Engineering', 'Computer Science and Engineering', 1);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH1240 - Electrical & Electronics Workshop\n\n'
    || E'This is a laboratory/workshop course (no theory modules).\n\n'
    || E'Practicals:\n'
    || E'1. Understanding of electronic component with specification.\n'
    || E'2. Understanding of Galvanometer, Voltmeter, Ammeter, Wattmeter and Multimeter.\n'
    || E'3. Understanding of breadboard connections.\n'
    || E'4. Drawing and wiring of basic circuits on breadboard.\n'
    || E'5. Verification of Ohm''s law.\n'
    || E'6. Half wave, full wave using centre tap transformer and full wave bridge rectifier.\n'
    || E'7. Kirchhoff''s laws (KVL, KCL).\n'
    || E'8. Faraday''s laws of Electromagnetic Induction and Electricity Lab.\n'
    || E'9. LDR characteristics.\n'
    || E'10. Study of CRO, measurement of amplitude (voltage) & time period (frequency).\n'
    || E'11. PCB designing.',
    E'Textbook:\nElectronic Principles — Albert Malvino and David J Bates — Mc Graw Hill (7th Edition)\n\nReference Books:\nElectronic Devices — Thomas L. Floyd — Pearson (7th Edition)\nElectronic Devices and Circuits — David A. Bell — Oxford Press (5th Edition)\nIntegrated Electronics — Jacob Millman, Christos — Tata McGraw Hill (2nd Edition)',
    '[{"sr_no":1,"name":"Understanding of electronic component with specification.","hours":2},{"sr_no":2,"name":"Understanding of Galvanometer, Voltmeter, Ammeter, Wattmeter and Multimeter","hours":2},{"sr_no":3,"name":"Understanding of breadboard connections","hours":2},{"sr_no":4,"name":"Drawing and wiring of basic circuits on breadboard","hours":2},{"sr_no":5,"name":"Verification of Ohm''s law","hours":2},{"sr_no":6,"name":"Half wave, full wave using centre tap transformer and full wave bridge rectifier","hours":3},{"sr_no":7,"name":"Kirchhoff''s laws (KVL,KCL).","hours":3},{"sr_no":8,"name":"Faraday''s laws of Electromagnetic Induction and Electricity Lab","hours":4},{"sr_no":9,"name":"LDR characteristics","hours":2},{"sr_no":10,"name":"Study of CRO, measurement of amplitude (voltage) & time period (frequency)","hours":4},{"sr_no":11,"name":"PCB designing","hours":4}]'::jsonb,
    NULL);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Identify the ability to design various electronic circuit on a bread board.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Recognize the basic electronic devices and components in a circuit connection.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Identify the ability to design a pcb.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Define the practical side of basic physics laws.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO8', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO8', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, NULL, NULL, 50, NULL, NULL, 50, 1);
END $$;

-- ================================================================
-- Subject: SESH1080 | Linear Algebra & Calculus | Sem 2 | 6 modules | 4 COs
-- BTL NOTE: source BTL table lists "Partial Derivatives" (not a module) and omits
-- "Fourier Series"; btl mapped by module name, Fourier left empty (-- MISSING).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Linear Algebra & Calculus', 'SESH1080', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH1080 - Linear Algebra & Calculus\n\n'
    || E'Module 1: Vector Space\nConcept of vector space, Subspace, Linear Combination, Linear Dependence and Independence, Span, Basis and Dimension, Row Space, Column Space and Null Space, Rank and Nullity.\n\n'
    || E'Module 2: Linear Transformation\nIntroduction of Linear Transformation, Kernal and Range, Rank and Nullity, Inverse of Linear Transformation, Rank Nullity Theorem, Composition of Linear Maps, Matrix associated with linear map.\n\n'
    || E'Module 3: Inner Product Space\nInner Product, Angle and Orthogonality, Orthogonal projection, Gram-Schmidt process and QR Decomposition, Least square decomposition, Change of basis.\n\n'
    || E'Module 4: Beta and Gamma function\nImproper Integrals, Convergence, Properties of Beta and Gamma Function, Duplication Formula (without proof).\n\n'
    || E'Module 5: Fourier Series\nPeriodic Function, Euler Formula, Arbitrary Period, Even and Odd function, Half Range Expansion, Parseval''s Theorem.\n\n'
    || E'Module 6: Curve tracing\nTracing of Cartesian Curves, Polar Coordinates, Polar and Parametric Form of Standard Curves, Areas and Length in Polar co-ordinates.',
    E'Textbooks:\nThomas'' Calculus — George B. Thomas, Maurice D. Weir and Joel Hass — Pearson\nElementary Linear Algebra — Howard Anton and Chrish Rorres — Wiley\n\nReference Books:\nAdvanced Engineering Mathematics — E Kreyszig — John Wiley & Sons\nA textbook of Engineering Mathematics — N P Bali and Manish Goyal — Laxmi\nHigher Engineering Mathematics — B S Grewal — Khanna\nEngineering Mathematics for First Year — T Veerarajan — Tata Mc Graw Hill\nEngineering Mathematics-1 (Calculus) — H. K. Dass and Dr. Rama Verma — S. Chand',
    '[{"sr_no":1,"name":"Vector Space-1","hours":4},{"sr_no":2,"name":"Vector Space-2","hours":2},{"sr_no":3,"name":"Linear Transformation-1","hours":4},{"sr_no":4,"name":"Linear Transformation-2","hours":2},{"sr_no":5,"name":"Inner Product-1","hours":4},{"sr_no":6,"name":"Inner Product-2","hours":2},{"sr_no":7,"name":"Beta and Gamma Function-1","hours":4},{"sr_no":8,"name":"Beta and Gamma Function-2","hours":2},{"sr_no":9,"name":"Curve tracing-1","hours":4},{"sr_no":10,"name":"Curve tracing-2","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Vector Space', 1, 'Concept of vector space, Subspace, Linear Combination, Linear Dependence and Independence, Span, Basis and Dimension, Row Space, Column Space and Null Space, Rank and Nullity.', 9, 20, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Linear Transformation', 2, 'Introduction of Linear Transformation, Kernal and Range, Rank and Nullity, Inverse of Linear Transformation, Rank Nullity Theorem, Composition of Linear Maps, Matrix associated with linear map.', 7, 15, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Inner Product Space', 3, 'Inner Product, Angle and Orthogonality, Orthogonal projection, Gram-Schmidt process and QR Decomposition, Least square decomposition, Change of basis.', 7, 15, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Beta and Gamma function', 4, 'Improper Integrals, Convergence, Properties of Beta and Gamma Function, Duplication Formula (without proof).', 6, 14, 2, ARRAY['1','2','4','5']),
   (gen_random_uuid(), subj_id, 'Fourier Series', 5, 'Periodic Function, Euler Formula, Arbitrary Period, Even and Odd function, Half Range Expansion, Parseval''s Theorem.', 8, 18, 2, ARRAY[]::text[]), -- MISSING: btl_levels (no Fourier row in source BTL table)
   (gen_random_uuid(), subj_id, 'Curve tracing', 6, 'Tracing of Cartesian Curves, Polar Coordinates, Polar and Parametric Form of Standard Curves, Areas and Length in Polar co-ordinates.', 8, 18, 2, ARRAY['1','2','4','5','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Define the concepts of Vector Space, Linear Transformation and Inner Product Space.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Practice functions like Gamma, Beta functions & their relation which is helpful to evaluate some definite integral arising in various branch of engineering.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Identify the Ordinary differentials and Partial differentials. Solve the maximum and minimum value of function.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Construct the graphs for function with intervals and identify more application for function.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 1);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, NULL, NULL, 50, 150, 5);
END $$;

-- ================================================================
-- Subject: SEIT1030 | Object Oriented Programming with Java | Sem 2 | 10 modules | 5 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Object Oriented Programming with Java', 'SEIT1030', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEIT1030 - Object Oriented Programming with Java\n\n'
    || E'Module 1: Introduction\nProgramming language Types and Paradigms, Flavors of Java, Java Designing Goal, Features of Java Language, JVM - The heart of Java, Java''s Magic Bytecode.\n\n'
    || E'Module 2: Object-Oriented Programming Fundamentals\nClass Fundamentals, Object and Object reference, Object Lifetime and Garbage Collection, Creating and Operating Objects, Constructor and initialization code block, Access Control, Modifiers, Nested class, Inner Class, Anonymous Classes, Abstract Class and Interfaces, Defining Methods, Method Overloading, Dealing with Static Members, Use of "this" reference, Use of Modifiers with Classes & Methods, Generic Class Types.\n\n'
    || E'Module 3: Java Environment and Data types\nThe Java Environment: Java Program Development, Java Source File Structure, Compilation Executions; Basic Language Elements: Lexical Tokens, Identifiers, Keywords, Literals, Comments, Primitive Datatypes, and Operators.\n\n'
    || E'Module 4: Class and Inheritance\nUse and Benefits of Inheritance in OOP, Types of Inheritance in Java, Inheriting Data Members and Methods, Role of Constructors in inheritance, Overriding Super Class Methods, Use of "super", Polymorphism in inheritance, Type Compatibility and Conversion, Implementing interfaces.\n\n'
    || E'Module 5: Java Packages\nOrganizing Classes and Interfaces in Packages, Package as Access Protection, Defining Package, CLASSPATH Setting for Packages, Making JAR Files for Library Packages, Import and Static Import, Naming Convention for Packages.\n\n'
    || E'Module 6: Array and String Concepts\nDefining an Array, Initializing & Accessing Array, Multi-Dimensional Array, Operation on String, Using Collection Bases Loop for String, tokenizing a String, Creating Strings using String Buffer.\n\n'
    || E'Module 7: Exception Handling\nThe Idea behind Exception, Exceptions & Errors, Types of Exception, Control Flow In Exceptions, JVM reaction to Exceptions, Use of try, catch, finally, throw, throw in Exception Handling, In-built and User Defined Exceptions, Checked and Un-Checked Exceptions.\n\n'
    || E'Module 8: Thread\nUnderstanding Threads, Needs of Multi-Threaded Programming, Thread Life-Cycle, Thread Priorities, Synchronizing Threads, Inter-Communication of Threads.\n\n'
    || E'Module 9: Applet\nApplet & Application, Applet Architecture, Parameters to Applet.\n\n'
    || E'Module 10: Input-Output Operations in Java\nStreams and the new I/O Capabilities, Understanding Streams, The Classes for Input and Output, The Standard Streams, Working with File Object, File I/O Basics, Reading and Writing to Files, Buffer and Buffer Management, Read/Write Operations with File, Channel, Serializing Objects.',
    E'Textbook:\nCore Java Volume I – Fundamentals — Cay Horstmann and Gray Cornell — Pearson\n\nReference Books:\nJava the complete reference — Herbert Schildt — McGraw Hill\nThinking in Java — Bruce Eckel — Pearson\nLearning Java — Patrick Niemeyer & Jonathan Knudsen — O''Reilly Media',
    '[{"sr_no":1,"name":"Introduction to Java Environment and Netbeans","hours":2},{"sr_no":2,"name":"Implementation of Java programs with classes and objects","hours":4},{"sr_no":3,"name":"Implementation of Java programs to create functions, constructors with overloading and overriding","hours":4},{"sr_no":4,"name":"Implementation of Java programs to demonstrate different access specifiers","hours":4},{"sr_no":5,"name":"Implementation of Java programs using the concept of inner classes","hours":2},{"sr_no":6,"name":"Implementation of Java programs for variables, data types, operators","hours":4},{"sr_no":7,"name":"Implementation of Java programs for inheritance (single, multilevel, hierarchical)","hours":4},{"sr_no":8,"name":"Implementation of Java programs to demonstrate the use of super keyword","hours":2},{"sr_no":9,"name":"Implementation of Java programs for anonymous and abstract classes","hours":2},{"sr_no":10,"name":"Implementation of Java programs for Interface","hours":2},{"sr_no":11,"name":"Implementation of Java programs to demonstrate Java packages","hours":2},{"sr_no":12,"name":"Implementation of Java programs to use arrays and string","hours":6},{"sr_no":13,"name":"Implementation of Java programs for exception handling using all keywords (try, catch, throw, throws and finally)","hours":4},{"sr_no":14,"name":"Implementation of Java programs to demonstrate the life cycle of thread","hours":2},{"sr_no":15,"name":"Implementation of Java programs for the concepts of thread priority, synchronization, inter-thread communication","hours":6},{"sr_no":16,"name":"Implementation of Applets, AWT and Web Servers","hours":6},{"sr_no":17,"name":"Implementation of file handling operations","hours":4}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'Programming language Types and Paradigms, Flavors of Java, Java Designing Goal, Features of Java Language, JVM - The heart of Java, Java''s Magic Bytecode.', 3, 5, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Object-Oriented Programming Fundamentals', 2, 'Class Fundamentals, Object and Object reference, Object Lifetime and Garbage Collection, Creating and Operating Objects, Constructor and initialization code block, Access Control, Modifiers, Nested class, Inner Class, Anonymous Classes, Abstract Class and Interfaces, Defining Methods, Method Overloading, Dealing with Static Members, Use of "this" reference, Use of Modifiers with Classes & Methods, Generic Class Types.', 6, 15, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Java Environment and Data types', 3, 'The Java Environment: Java Program Development, Java Source File Structure, Compilation Executions; Basic Language Elements: Lexical Tokens, Identifiers, Keywords, Literals, Comments, Primitive Datatypes, and Operators.', 5, 10, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Class and Inheritance', 4, 'Use and Benefits of Inheritance in OOP, Types of Inheritance in Java, Inheriting Data Members and Methods, Role of Constructors in inheritance, Overriding Super Class Methods, Use of "super", Polymorphism in inheritance, Type Compatibility and Conversion, Implementing interfaces.', 7, 15, 1, ARRAY['2','5','6']),
   (gen_random_uuid(), subj_id, 'Java Packages', 5, 'Organizing Classes and Interfaces in Packages, Package as Access Protection, Defining Package, CLASSPATH Setting for Packages, Making JAR Files for Library Packages, Import and Static Import, Naming Convention for Packages.', 2, 5, 1, ARRAY['2','4','5']),
   (gen_random_uuid(), subj_id, 'Array and String Concepts', 6, 'Defining an Array, Initializing & Accessing Array, Multi-Dimensional Array, Operation on String, Using Collection Bases Loop for String, tokenizing a String, Creating Strings using String Buffer.', 4, 10, 2, ARRAY['2','3','6']),
   (gen_random_uuid(), subj_id, 'Exception Handling', 7, 'The Idea behind Exception, Exceptions & Errors, Types of Exception, Control Flow In Exceptions, JVM reaction to Exceptions, Use of try, catch, finally, throw, throw in Exception Handling, In-built and User Defined Exceptions, Checked and Un-Checked Exceptions.', 5, 10, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Thread', 8, 'Understanding Threads, Needs of Multi-Threaded Programming, Thread Life-Cycle, Thread Priorities, Synchronizing Threads, Inter-Communication of Threads.', 6, 15, 2, ARRAY['3','5','6']),
   (gen_random_uuid(), subj_id, 'Applet', 9, 'Applet & Application, Applet Architecture, Parameters to Applet.', 3, 5, 2, ARRAY['3','6']),
   (gen_random_uuid(), subj_id, 'Input-Output Operations in Java', 10, 'Streams and the new I/O Capabilities, Understanding Streams, The Classes for Input and Output, The Standard Streams, Working with File Object, File I/O Basics, Reading and Writing to Files, Buffer and Buffer Management, Read/Write Operations with File, Channel, Serializing Objects.', 4, 10, 2, ARRAY['4','5','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Learn and acquire principles of object oriented programming concepts and its application using java programming.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Identify syntax, semantics, data types, conditional statements, control structures, and arrays and strings in java programming language.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Explain building blocks of java classes, objects, constructors and methods in console based java application.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Identify the concept of polymorphism, inheritance, abstraction and interfaces and construct programs in java.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Classify the role of packages and exception handling for access protection, name space management and reliability of code.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO6', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 40, 60, NULL, 200, 5);
END $$;

-- ================================================================
-- Subject: SEIT1010 | Introduction to Web Designing | Sem 2 | 0 modules | 4 COs
-- NOTE: laboratory course — no theory modules (modules omitted).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Introduction to Web Designing', 'SEIT1010', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEIT1010 - Introduction to Web Designing\n\n'
    || E'This is a laboratory course (no theory modules).\n\n'
    || E'Practicals:\n'
    || E'1. Implementation of HTML tags.\n'
    || E'2. Designing Websites with basic CSS.\n'
    || E'3. Designing of Responsive Website Designs using Java Script.\n'
    || E'4. Development of mini project based on HTML, CSS and Java Script.',
    E'Reference Book:\nHTML Black Book — Steven Holzner — Dreamtech press',
    '[{"sr_no":1,"name":"Implementation of HTML tags","hours":12},{"sr_no":2,"name":"Designing Websites with basic CSS","hours":4},{"sr_no":3,"name":"Designing of Responsive Website Designs using Java Script","hours":4},{"sr_no":4,"name":"Development of mini project based on HTML, CSS and Java Script","hours":10}]'::jsonb,
    NULL);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Discover the fundamentals of website designing and webpage designing.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Create a webpage with different look and structure.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Manipulate the data as per the user requirement.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Write a code for generating a small website.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO10', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO11', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO12', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 3);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, NULL, NULL, 50, NULL, NULL, 50, 1);
END $$;

-- ================================================================
-- Subject: SEME1020 | Engineering Workshop | Sem 2 | 0 modules | 5 COs
-- NOTE: laboratory/workshop course — no theory modules (modules omitted).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Engineering Workshop', 'SEME1020', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEME1020 - Engineering Workshop\n\n'
    || E'This is a laboratory/workshop course (no theory modules).\n\n'
    || E'Practicals:\n'
    || E'1. Introduction and Demonstration of Safety Norms. Different Measuring Instruments.\n'
    || E'2. To Perform a Job of Fitting Shop.\n'
    || E'3. To Perform a Job of Carpentry Shop.\n'
    || E'4. To Perform a Job of Sheet Metal Shop.\n'
    || E'5. To Perform a Job of Black Smithy Shop.\n'
    || E'6. Introduction and Demonstration of Grinding & Hacksaw Cutting Machine.\n'
    || E'7. Introduction and Demonstration of Plumbing Shop & Welding Process.',
    E'Textbooks:\nElements of Workshop Technology Vol. I — Hajra Chaudhary S. K. — Media promoters & Publishers\nWorkshop Technology Vol. I and II — Raghuvanshi B.S. — Dhanpat Rai & Sons\n\nReference Books:\nWorkshop Technology Vol. I — W.A.J. Chapman — Edward Donald Publication\nWorkshop Practices — H S Bawa — Tata McGraw-Hill\nBasic Machine Shop Practice Vol. I, II — Tejwani V. K. — Tata McGraw-Hill',
    '[{"sr_no":1,"name":"Introduction and Demonstration of Safety Norms. Different Measuring Instruments.","hours":2},{"sr_no":2,"name":"To Perform a Job of Fitting Shop.","hours":6},{"sr_no":3,"name":"To Perform a Job of Carpentry Shop.","hours":6},{"sr_no":4,"name":"To Perform a Job of Sheet Metal Shop.","hours":6},{"sr_no":5,"name":"To Perform a Job of Black Smithy Shop.","hours":4},{"sr_no":6,"name":"Introduction and Demonstration of Grinding & Hacksaw Cutting Machine.","hours":2},{"sr_no":7,"name":"Introduction and Demonstration of Plumbing Shop & Welding Process.","hours":4}]'::jsonb,
    NULL);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Understand the various measuring instruments.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Understand the safety norms required in the workshop.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Understand the application of various tools required for different operations.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Remember the process of manufacture from a given raw material.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Explain various manufacturing processes in machine shop.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO8', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO8', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 3),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO6', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 3),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO5', 'PSO3', 3);
   -- CO2 has no CO-PSO strengths in the source table

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, NULL, NULL, 50, NULL, NULL, 50, 1);
END $$;

-- ================================================================
-- Subject: SEME1040 | Concepts of Engineering Drawing | Sem 2 | 4 modules | 5 COs
-- BTL NOTE: source BTL table has 6 rows incl. extra "Principles of Projections" and
-- "Projection of Plane"; btl mapped to the 4 content modules by name/topic.
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Concepts of Engineering Drawing', 'SEME1040', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEME1040 - Concepts of Engineering Drawing\n\n'
    || E'Module 1: Introduction\nImportance of the course; Use of Drawing Instruments and Accessories; BIS – SP – 46; Lettering, Dimensioning and Lines; Representative Fraction; Types of Scales (Plain and Diagonal Scales); Construction of Polygons.\n\n'
    || E'Module 2: Engineering Curves\nClassification and Application of Engineering Curves; Construction of Conics, Cycloidal Curves, Involutes and Spiral along with Normal and Tangent to each.\n\n'
    || E'Module 3: Orthographic Projection\nTypes of Projections: Principle of First and Third Angle Projection - Applications & Difference; Projection from Pictorial View of Object, View from Front, Top and Sides.\n\n'
    || E'Module 4: Isometric Projections and Isometric Drawing\nIsometric Scale, Conversion of Orthographic Views into Isometric Projection, Isometric View or Drawing.',
    E'Textbooks:\nA Text Book of Engineering Graphics — P J Shah — S. Chand & Company Ltd., New Delhi\nEngineering Drawing — N D Bhatt — Charotar Publishing House, Anand\n\nReference Books:\nEngineering Drawing — P.S.Gill — S. K. Kataria & sons, Delhi\nEngineering Drawing — B. Agrawal & C M Agrawal — Tata McGraw Hill, New Delhi\nEngineering Drawing made Easy — K. Venugopal — Wiley Eastern Ltd',
    '[{"sr_no":1,"name":"Introduction sheet (dimensioning methods, different types of line, construction of different polygon, divide the line and angle in parts, use of stencil, lettering)","hours":4},{"sr_no":2,"name":"Plane scale and Diagonal scale","hours":4},{"sr_no":3,"name":"Engineering curves","hours":6},{"sr_no":4,"name":"Projection of Points and Plane","hours":4},{"sr_no":5,"name":"Orthographic Projection","hours":6},{"sr_no":6,"name":"Isometric Projection","hours":6}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'Importance of the course; Use of Drawing Instruments and Accessories; BIS – SP – 46; Lettering, Dimensioning and Lines; Representative Fraction; Types of Scales (Plain and Diagonal Scales); Construction of Polygons.', 7, 25, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Engineering Curves', 2, 'Classification and Application of Engineering Curves; Construction of Conics, Cycloidal Curves, Involutes and Spiral along with Normal and Tangent to each.', 8, 25, 1, ARRAY['2','3','6']),
   (gen_random_uuid(), subj_id, 'Orthographic Projection', 3, 'Types of Projections: Principle of First and Third Angle Projection - Applications & Difference; Projection from Pictorial View of Object, View from Front, Top and Sides.', 8, 25, 2, ARRAY['4','5','6']),
   (gen_random_uuid(), subj_id, 'Isometric Projections and Isometric Drawing', 4, 'Isometric Scale, Conversion of Orthographic Views into Isometric Projection, Isometric View or Drawing.', 7, 25, 2, ARRAY['4','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Remember bis standards while drawing lines and representing letters & dimensions.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Understand different types of scaling and, construction of geometrical shapes using engineering tools.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Classify the projection angles concerning the observer, object, and reference planes.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Construct orthographic views of an object when its position with respect to the reference planes is defined.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Develop 3d isometric views concerning 2d orthographic views and vice versa.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 1);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO5', 'PSO3', 1);
   -- CO1 has no CO-PSO strengths in the source table

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SESH1210 | Applied Physics | Sem 2 | 7 modules | 5 COs
-- BTL NOTE: source BTL table topics drift from the module list (it adds
-- "Superconductivity" and splits "Non linear Optics" in two). btl mapped by
-- module name; "Solid State Physics" and "DC and AC Circuits Fundamentals" have
-- no matching BTL row (-- MISSING).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Applied Physics', 'SESH1210', 'Engineering', 'Computer Science and Engineering', 2);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH1210 - Applied Physics\n\n'
    || E'Module 1: Quantum Mechanics\nWave-Particle Duality, De-Broglie Matter Wave, Phase and Group Velocity, Heisenberg Uncertainty Principle and its Applications, Wave Function and its Significance, Schrodinger''s Wave Equation, Particle in One Dimensional Box.\n\n'
    || E'Module 2: Acoustic and Ultrasonic\nIntroduction, Classification and Characterization of Sound, Absorption Coefficients, Sound Absorbing Materials, Sound Insulation, Ultrasonic, Properties of Ultrasonic, Generation of Ultrasonic, Applications of Ultrasonic.\n\n'
    || E'Module 3: Solid State Physics\nIntroduction, Lattice Points and Space Lattice, Unit Cells and Lattice Parameters, Primitive Cell, Crystal Systems. The Bravais Space Lattices. Miller Indices, X-Ray Properties, Diffraction and Bragg''s Law, Bragg''s X-Ray Spectrum.\n\n'
    || E'Module 4: Nanophysics\nNanoscale, Surface to Volume Ratio, Surface Effects on Nanomaterials, Quantum Size Effects, Nanomaterials and Nanotechnology, Unusual Properties of Nanomaterials, Synthesis of Nanomaterials, Applications of Nanomaterials.\n\n'
    || E'Module 5: Non-Linear Optics\nLaser, Spontaneous and Stimulated Emission of Light, Applications of Laser. Fundamental Ideas about Optical Fibre, Advantages of Optical Fibre of Optical Fibre, Applications of Optical Fibre.\n\n'
    || E'Module 6: DC and AC Circuits Fundamentals\nIntroduction of Electrical Current, Voltage, Power and Energy; Sources of Electrical Energy Inductor and Capacitor, Fundamental Laws of Electric Circuits – Ohm''s Law and Kirchhoff''s Laws; Analysis of Series, Parallel and Series-Parallel Circuits. Alternating Voltages and Currents and their Vector and Time Domain Representations, Average and Rms Values, From Factor, Phase Difference, Power and Power Factor, Purely Resistive Inductive and Capacitive Circuits, R-L, R-C, R-L-C Series Circuits, Impedance and Admittance, Circuits in Parallel, Series and Parallel Resonance.\n\n'
    || E'Module 7: Electronics\nSemiconductors, Intrinsic and Extrinsic Semiconductor Advantages of Semiconductor Devices, Diodes, Transistors, Types of Bipolar Junction Transistor, Unijunction Junction Transistor, FET and MOSFETS.',
    E'Textbooks:\nConcept of the Modern Physics — A. Beiser — Tata McGraw-Hill Education\nBasic electrical engineering — Kothari and Nagrath — Tata McGraw-Hill Education\nQuantum Mechanics — P.M. Mathew, K. Venkatesan — Tata McGraw-Hill Education\nWaves and Acoustics — Pradipkumar Chakrabarti, Satyabrata Chawdhary — New Central Book Agency\nLasers and Nonlinear Optics — G.D. Baruah — Pragati Prakashan\nSolid State Physics / Basic Electronics — S.O. Pillai — New Age International Publishers\nBasic Electronics for Scientists and Engineers — Dennis L. Eggleston — Cambridge University Press',
    '[{"sr_no":1,"name":"Volt-Ampere Characteristics of Light Emitting Diode","hours":2},{"sr_no":2,"name":"Volt-Ampere Characteristics of Zener Diode","hours":2},{"sr_no":3,"name":"To determine value of Planck''s constant (h) using a photovoltaic cell","hours":2},{"sr_no":4,"name":"To determine the Hall coefficient (R) and carrier concentration of a given material (Ge) using Hall effect.","hours":4},{"sr_no":5,"name":"To study the Capacitors in series and parallel DC circuit.","hours":4},{"sr_no":6,"name":"To determine velocity of sound in liquid using Ultrasonic Interferometer","hours":4},{"sr_no":7,"name":"To study RLC Series circuit.","hours":2},{"sr_no":8,"name":"To determine numerical aperture of an optical fiber.","hours":4},{"sr_no":9,"name":"Determination of Young''s Modulus of given material.","hours":4},{"sr_no":10,"name":"Analysis of errors.","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Quantum Mechanics', 1, 'Wave-Particle Duality, De-Broglie Matter Wave, Phase and Group Velocity, Heisenberg Uncertainty Principle and its Applications, Wave Function and its Significance, Schrodinger''s Wave Equation, Particle in One Dimensional Box.', 6, 15, 1, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'Acoustic and Ultrasonic', 2, 'Introduction, Classification and Characterization of Sound, Absorption Coefficients, Sound Absorbing Materials, Sound Insulation, Ultrasonic, Properties of Ultrasonic, Generation of Ultrasonic, Applications of Ultrasonic.', 5, 10, 1, ARRAY['1','3']),
   (gen_random_uuid(), subj_id, 'Solid State Physics', 3, 'Introduction, Lattice Points and Space Lattice, Unit Cells and Lattice Parameters, Primitive Cell, Crystal Systems. The Bravais Space Lattices. Miller Indices, X-Ray Properties, Diffraction and Bragg''s Law, Bragg''s X-Ray Spectrum.', 6, 10, 1, ARRAY[]::text[]), -- MISSING: btl_levels (no Solid State row in source BTL table)
   (gen_random_uuid(), subj_id, 'Nanophysics', 4, 'Nanoscale, Surface to Volume Ratio, Surface Effects on Nanomaterials, Quantum Size Effects, Nanomaterials and Nanotechnology, Unusual Properties of Nanomaterials, Synthesis of Nanomaterials, Applications of Nanomaterials.', 6, 15, 1, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'Non-Linear Optics', 5, 'Laser, Spontaneous and Stimulated Emission of Light, Applications of Laser. Fundamental Ideas about Optical Fibre, Advantages of Optical Fibre of Optical Fibre, Applications of Optical Fibre.', 7, 12, 2, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'DC and AC Circuits Fundamentals', 6, 'Introduction of Electrical Current, Voltage, Power and Energy; Sources of Electrical Energy Inductor and Capacitor, Fundamental Laws of Electric Circuits – Ohm''s Law and Kirchhoff''s Laws; Analysis of Series, Parallel and Series-Parallel Circuits. Alternating Voltages and Currents and their Vector and Time Domain Representations, Average and Rms Values, From Factor, Phase Difference, Power and Power Factor, Purely Resistive Inductive and Capacitive Circuits, R-L, R-C, R-L-C Series Circuits, Impedance and Admittance, Circuits in Parallel, Series and Parallel Resonance.', 8, 25, 2, ARRAY[]::text[]), -- MISSING: btl_levels (no DC/AC row in source BTL table)
   (gen_random_uuid(), subj_id, 'Electronics', 7, 'Semiconductors, Intrinsic and Extrinsic Semiconductor Advantages of Semiconductor Devices, Diodes, Transistors, Types of Bipolar Junction Transistor, Unijunction Junction Transistor, FET and MOSFETS.', 7, 13, 2, ARRAY['3','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Understand the framework of quantum mechanics and apply the knowledge of basic quantum mechanics to construct one dimensional schrodinger''s wave equation.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Classify the phenomenon of acoustics and ultrasonic in various engineering field and apply it for various engineering and medical fields. interpret the concept of nanotechnology and understand the synthesis and applications of nanomaterials from technological prospect.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Discover the types and properties of superconductors. relate the behaviour of superconductors at high temperatures.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Describe the laser and articulate the idea of optical fiber communications and apply the concepts of lasers and optical fiber communications in every possible sector.'),
   (gen_random_uuid(), subj_id, 'CO5', 'distinguish pure, impure semiconductors and characteristics of semiconductor devices. thus will be able to use basic concepts to analyze and design a wide range of semiconductor devices.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 3),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO6', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 3);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SESH2040 | Discrete Mathematics | Sem 3 | 6 modules | 4 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Discrete Mathematics', 'SESH2040', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH2040 - Discrete Mathematics\n\n'
    || E'Module 1: Set, Relation & Function\nSets, Set operations, Introduction of Relations, Relations of Sets, Types of Relations, Properties of Relations, Equivalence Relation, Partial Ordering, Hasse Diagram, GLB & LUB, Functions, Classification of functions, Types of functions, Composition of function, Recursive function.\n\n'
    || E'Module 2: Lattices\nDefinition & properties of Lattice, Lattices as Algebraic System, Sublattices, Types of lattices, Distributive lattices, Modular lattices, Complemented lattices, Bounded lattices, Complete lattices, Finite Boolean algebra.\n\n'
    || E'Module 3: Group Theory\nBinary operations, Properties of Group, Groupoid, semigroup & monoid, Abelian group, Subgroup, Cosets, Normal subgroup, Lagrange''s theorem, Cyclic group, Permutation group, Homomorphism & Isomorphism of groups.\n\n'
    || E'Module 4: Mathematical Logic and Proof\nPropositions, logical operators, Algebra of proposition, Predicates & quantifiers, Nested Quantifiers, Rules of Inference, Proof Methods, Program Correctness techniques.\n\n'
    || E'Module 5: Graph Theory\nGraphs and Graph Models, Graph Terminology and Types of graphs, Representing graphs and Isomorphism, Connectivity, Euler and Hamilton Paths-Circuits, Applications of weighted graphs.\n\n'
    || E'Module 6: Tree\nIntroduction to Trees, Rooted Tree, Properties of tree, Binary tree, Tree Traversal, Spanning Tree, DFS, BFS, Minimum Spanning Tree, Prim''s Algorithm, Kruskal''s Algorithm.',
    E'Textbook:\nDiscrete Mathematics and its Applications — Kenneth Rosen — McGraw Hill, New York\n\nReference Books:\nA Textbook of Discrete Mathematics — Dr. Swapan Kumar Sarkar — S. Chand & Company Ltd., New Delhi\nDiscrete Mathematical Structure with Applications to Computer Science — J.P. Trembly, R. Manohar — Tata McGraw-Hill Publishing Company Ltd. New Delhi\nGraph Theory with Applications to Engineering and Computer Science — Narsingh Deo — PHI Learning Pvt. Ltd. New Delhi',
    '[{"sr_no":1,"name":"Problems based on Set, Relation & Function-1","hours":2},{"sr_no":2,"name":"Problems based on Set, Relation & Funciton-2","hours":2},{"sr_no":3,"name":"Problems based on Set, Relation & Funciton-3","hours":2},{"sr_no":4,"name":"Problems based on Lattices","hours":4},{"sr_no":5,"name":"Problems based on Group Theory-1","hours":2},{"sr_no":6,"name":"Problems based on Group Theory-2","hours":4},{"sr_no":7,"name":"Problems based on Mathematical Logic and Proof","hours":2},{"sr_no":8,"name":"Problems based on Graph Theory-1","hours":2},{"sr_no":9,"name":"Problems based on Graph Theory-2","hours":2},{"sr_no":10,"name":"Problems based on Graph Theory-3","hours":4},{"sr_no":11,"name":"Problems based on Tree-1","hours":2},{"sr_no":12,"name":"Problems based on Tree-2","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Set, Relation & Function', 1, 'Sets, Set operations, Introduction of Relations, Relations of Sets, Types of Relations, Properties of Relations, Equivalence Relation, Partial Ordering, Hasse Diagram, GLB & LUB, Functions, Classification of functions, Types of functions, Composition of function, Recursive function.', 8, 17, 1, ARRAY['1','2','4','6']),
   (gen_random_uuid(), subj_id, 'Lattices', 2, 'Definition & properties of Lattice, Lattices as Algebraic System, Sublattices, Types of lattices, Distributive lattices, Modular lattices, Complemented lattices, Bounded lattices, Complete lattices, Finite Boolean algebra.', 7, 16, 1, ARRAY['1','2','3','4','6']),
   (gen_random_uuid(), subj_id, 'Group Theory', 3, 'Binary operations, Properties of Group, Groupoid, semigroup & monoid, Abelian group, Subgroup, Cosets, Normal subgroup, Lagrange''s theorem, Cyclic group, Permutation group, Homomorphism & Isomorphism of groups.', 8, 17, 1, ARRAY['1','2','3','5','6']),
   (gen_random_uuid(), subj_id, 'Mathematical Logic and Proof', 4, 'Propositions, logical operators, Algebra of proposition, Predicates & quantifiers, Nested Quantifiers, Rules of Inference, Proof Methods, Program Correctness techniques.', 6, 14, 2, ARRAY['1','2','3','4','6']),
   (gen_random_uuid(), subj_id, 'Graph Theory', 5, 'Graphs and Graph Models, Graph Terminology and Types of graphs, Representing graphs and Isomorphism, Connectivity, Euler and Hamilton Paths-Circuits, Applications of weighted graphs.', 8, 18, 2, ARRAY['1','2','3','5','6']),
   (gen_random_uuid(), subj_id, 'Tree', 6, 'Introduction to Trees, Rooted Tree, Properties of tree, Binary tree, Tree Traversal, Spanning Tree, DFS, BFS, Minimum Spanning Tree, Prim''s Algorithm, Kruskal''s Algorithm.', 8, 18, 2, ARRAY['1','2','3','5','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Summarize the concepts of set theory for understanding & fetching data from a database using query.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Classify the basic concepts of spanning tree algorithms namely DFA, BFS, Prim''s and Kruskal''s in the design of networks.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Construct the algorithm of group theory for data encryption.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Combination of design, foundational concepts of notations and results of graph theory used for better understanding of problems.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);
   -- source CO-PSO table also lists a CO5 row (no CO5 outcome defined); omitted

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, NULL, NULL, 50, 150, 5);
END $$;

-- ================================================================
-- Subject: SECE2111 | Database Management System | Sem 3 | 8 modules | 4 COs
-- Prerequisite: Introduction to Computer Programming (SECE1020)
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Database Management System', 'SECE2111', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2111 - Database Management System\nPrerequisite: Introduction to Computer Programming (SECE1020)\n\n'
    || E'Module 1: Introduction\nFile Organization, Comparison of File with DBMS, Application of DBMS, Purpose of DBMS, Views of data - level of abstraction, data independence, database architecture, database users & administrators.\n\n'
    || E'Module 2: Relational Model\nStructure of relational databases, Domains, Relations, Relational algebra operators and syntax, Relational algebra queries.\n\n'
    || E'Module 3: SQL Concepts\nBasics of SQL, DDL, DML, DCL, Structure: creation, alteration, defining constraints: Primary key, foreign key, Unique key, not null, check, IN operator, Aggregate functions, Built-in functions: numeric, date, string functions, set operations, Subqueries, correlated sub-queries: Join, Exist, Any, All, view and its types. Transaction control commands - Commit, Rollback, Savepoint.\n\n'
    || E'Module 4: Query Processing\nOverview, Measures of query cost, selection operation, Sorting, Join, Evaluation of expressions.\n\n'
    || E'Module 5: Entity Relational Model\nEntity-Relationship model: Basic concepts, Design process Constraints, Keys, Design issues, E-R diagrams, Weak entity sets, extended E-R features - generalization, specialization, aggregation, reduction to E-R database schema.\n\n'
    || E'Module 6: Database Design Concepts\nFunctional Dependency, definition, Trivial and non-trivial FD, Closure of FD set, closure of attributes, Irreducible set of FD, Normalization: 1NF, 2NF, 3NF, Decomposition using FD, Dependency preservation, BCNF, Multivalued dependency, 4NF Join dependency and 5NF, RAID Concepts.\n\n'
    || E'Module 7: Transaction Management\nTransaction concepts, Properties of Transactions, Serializability of transactions, testing for serializability, system recovery, Two-Phase Commit protocol, Recovery and Atomicity, Log-based recovery, Concurrent executions of transactions and related problems, Locking mechanisms, Solution to Concurrency Related Problems, Deadlock, Two-phase locking protocol.\n\n'
    || E'Module 8: PL/SQL Concepts\nCursors, Stored Procedures, Stored Function, Database Triggers, Indices.',
    E'Textbooks:\nDatabase System Concept — Abraham Silberschatz, Henry F. Korth, S. Sudarshan — McGraw Hill\nSQL, PL/SQL-The Programming Language of Oracle — Ivan Bayross — BPB Publications\n\nReference Books:\nAn Introduction to Database system — C J Date — Addition-Wesley\nFundamental of Database system — R. Elmasri and S.B Navathe — The Benjamin/Cumming\nSQL, PL/SQL the Programming Language of Oracle — Ivan Bayross — BPB Publications\nOracle: The Complete Reference — George Koch, Kevin Loney — TMH / Oracle Press',
    '[{"sr_no":1,"name":"Introduction to DBMS, SQL, and SQL tools.","hours":1},{"sr_no":2,"name":"Implementation of a client-server architecture using TightVNC Server and Client software (remote access of a server by clients)","hours":1},{"sr_no":3,"name":"Introduction to Data Dictionary concepts.","hours":1},{"sr_no":4,"name":"Create all the master tables using Data Definition Language Commands like Create and Describe.","hours":1},{"sr_no":5,"name":"Implement the use of alter table command.","hours":1},{"sr_no":6,"name":"Introduction to Transaction Control Commands like Commit, Rollback and Save point.","hours":1},{"sr_no":7,"name":"Use insert command to add data into created tables.","hours":1},{"sr_no":8,"name":"Solve queries using update command.","hours":1},{"sr_no":9,"name":"Implement SQL queries based on update and delete command.","hours":1},{"sr_no":10,"name":"Write SQL queries to solve problems with the use of the select command.","hours":1},{"sr_no":11,"name":"Generate different reports using select command.","hours":1},{"sr_no":12,"name":"Introduction to SQL functions.","hours":1},{"sr_no":13,"name":"Write SQL scripts to implement the listed queries, which require the usage of numerous SQL functions.","hours":1},{"sr_no":14,"name":"Introduction to group functions and demonstration of their usage.","hours":1},{"sr_no":15,"name":"Implement queries based on group by and having a clause.","hours":1},{"sr_no":16,"name":"Execution of queries based on natural and inner joins.","hours":1},{"sr_no":17,"name":"Implement SQL queries based on outer join and self-join.","hours":1},{"sr_no":18,"name":"Write SQL queries based on group function and join.","hours":1},{"sr_no":19,"name":"Introduction to sub-queries and demonstration of their usage.","hours":1},{"sr_no":20,"name":"Write SQL queries based on the concept of single row sub-queries.","hours":1},{"sr_no":21,"name":"Write SQL queries based on the concept of multiple row sub-queries.","hours":1},{"sr_no":22,"name":"Write SQL scripts to generate desired reports using group by, join and subqueries.","hours":1},{"sr_no":23,"name":"Write SQL script to solve the questions based on all SQL concepts.","hours":1},{"sr_no":24,"name":"Write the required SQL scripts to implement all the listed queries using Data Control Commands like Grant and Revoke.","hours":1},{"sr_no":25,"name":"Introduction to different objects in SQL and create views based on given scenarios.","hours":1},{"sr_no":26,"name":"Write the required SQL script to implement the given triggers.","hours":1},{"sr_no":27,"name":"Write the required SQL script to implement the given triggers.","hours":1},{"sr_no":28,"name":"Write the required SQL script to implement the given functions and procedures using PL/SQL block scripts.","hours":1},{"sr_no":29,"name":"Write the SQL scripts to implement the given cursors.","hours":1},{"sr_no":30,"name":"Submission of DBMS Mini Project Design.","hours":1}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'File Organization, Comparison of File with DBMS, Application of DBMS, Purpose of DBMS, Views of data - level of abstraction, data independence, database architecture, database users & administrators.', 4, 10, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Relational Model', 2, 'Structure of relational databases, Domains, Relations, Relational algebra operators and syntax, Relational algebra queries.', 4, 10, 1, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'SQL Concepts', 3, 'Basics of SQL, DDL, DML, DCL, Structure: creation, alteration, defining constraints: Primary key, foreign key, Unique key, not null, check, IN operator, Aggregate functions, Built-in functions: numeric, date, string functions, set operations, Subqueries, correlated sub-queries: Join, Exist, Any, All, view and its types. Transaction control commands - Commit, Rollback, Savepoint.', 10, 22, 1, ARRAY['3','4','6']),
   (gen_random_uuid(), subj_id, 'Query Processing', 4, 'Overview, Measures of query cost, selection operation, Sorting, Join, Evaluation of expressions.', 4, 8, 1, ARRAY['2','5']),
   (gen_random_uuid(), subj_id, 'Entity Relational Model', 5, 'Entity-Relationship model: Basic concepts, Design process Constraints, Keys, Design issues, E-R diagrams, Weak entity sets, extended E-R features - generalization, specialization, aggregation, reduction to E-R database schema.', 8, 20, 2, ARRAY['2','3','6']),
   (gen_random_uuid(), subj_id, 'Database Design Concepts', 6, 'Functional Dependency, definition, Trivial and non-trivial FD, Closure of FD set, closure of attributes, Irreducible set of FD, Normalization: 1NF, 2NF, 3NF, Decomposition using FD, Dependency preservation, BCNF, Multivalued dependency, 4NF Join dependency and 5NF, RAID Concepts.', 7, 14, 2, ARRAY['2','3','5']),
   (gen_random_uuid(), subj_id, 'Transaction Management', 7, 'Transaction concepts, Properties of Transactions, Serializability of transactions, testing for serializability, system recovery, Two-Phase Commit protocol, Recovery and Atomicity, Log-based recovery, Concurrent executions of transactions and related problems, Locking mechanisms, Solution to Concurrency Related Problems, Deadlock, Two-phase locking protocol.', 5, 10, 2, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'PL/SQL Concepts', 8, 'Cursors, Stored Procedures, Stored Function, Database Triggers, Indices.', 3, 6, 2, ARRAY['3','4','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Understand the importance of back end design and relational database management system.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Apply physical data, conceptual data and its conversion into relational databases.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Practice various database constraints on relational databases.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Design and develop database for the software projects.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SECE2021 | Digital Workshop | Sem 3 | 0 modules | 4 COs
-- Prerequisite: Programming for problem solving (SECE1050)
-- NOTE: laboratory/workshop course — no theory modules (modules omitted).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Digital Workshop', 'SECE2021', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2021 - Digital Workshop\nPrerequisite: Programming for problem solving (SECE1050)\n\n'
    || E'This is a laboratory/workshop course (no theory modules).\n\n'
    || E'Practicals:\n'
    || E'1. Introduction to Binary system.\n'
    || E'2. Introduction to Boolean Algebra and Logic Gates.\n'
    || E'3. Study and verification of all logic gates.\n'
    || E'4. Design and Implementation of Half Adder, Half Subtractor circuits.\n'
    || E'5. Design and Implementation Full Adder and Full Subtractor circuits.\n'
    || E'6. Comparator, Decoders, Multiplexers.\n'
    || E'7. Realization of Sum of Product and Product of Sum expression using universal gates.\n'
    || E'8. Design and Implementation of Parity Generator and Checker circuits.\n'
    || E'9. Introduction to sequential Circuit: S-R Latch.\n'
    || E'10. Introduction to sequential Circuit: Flip-Fop.',
    E'Textbook:\nDigital Electronic Principles and Integrated Circuit — A. K. Maini — Wiley\n\nReference Books:\nDigital Circuits and Logic Design — Samuel C. Lee — Prentice Hall India Learning Pvt Ltd.\nDigital Logic and Computer Design — M. Morris Mano — Pearson\nFundamentals of Digital Electronics and Circuits — Anand Kumar — Prentice Hall India Learning Pvt Ltd.',
    '[{"sr_no":1,"name":"Introduction to Binary system.","hours":4},{"sr_no":2,"name":"Introduction to Boolean Algebra and Logic Gates.","hours":4},{"sr_no":3,"name":"Study and verification of all logic gates.","hours":2},{"sr_no":4,"name":"Design and Implementation of Half Adder, Half Subtractor circuits.","hours":2},{"sr_no":5,"name":"Design and Implementation Full Adder and Full Subtractor circuits.","hours":2},{"sr_no":6,"name":"Comparator, Decoders, Multiplexers.","hours":4},{"sr_no":7,"name":"Realization of Sum of Product and Product of Sum expression using universal gates.","hours":2},{"sr_no":8,"name":"Design and Implementation of Parity Generator and Checker circuits.","hours":2},{"sr_no":9,"name":"Introduction to sequential Circuit: S-R Latch.","hours":4},{"sr_no":10,"name":"Introduction to sequential Circuit: Flip-Fop.","hours":4}]'::jsonb,
    NULL);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Identify the basic logic gates and apply them to digital circuits.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Understand the breadboard for implementation of circuits using discrete electronic components.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Remember and understand the core concepts of digital logic design like number base representation, boolean algebra etc.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Develop the ability to design combinational and sequential circuits.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, NULL, NULL, 20, 30, NULL, 50, 2);
END $$;

-- ================================================================
-- Subject: SECE2031 | Data Structures | Sem 3 | 9 modules | 4 COs
-- Prerequisite: Introduction to Computer Programming (SECE1020)
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Data Structures', 'SECE2031', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2031 - Data Structures\nPrerequisite: Introduction to Computer Programming (SECE1020)\n\n'
    || E'Module 1: Introduction\nObject and Instance, Object-Oriented Concepts, Data types, Types of Data Structure, Abstract Data Types.\n\n'
    || E'Module 2: Array\nArray Representation, Array as an Abstract Data Type, Programming Array in C, Sparse Matrices, Sparse Representations, and its Advantages, Row-measure Order and Column-measure Order representation.\n\n'
    || E'Module 3: Searching and Sorting\nLinear Search, Binary Search, Bubble Sort, Insertion Sort, Selection Sort, Radix sort.\n\n'
    || E'Module 4: Stack and Queue\nStack Definition and concepts, Operations on stack, Programming Stack using Array in C, Prefix and Postfix Notations and their Compilation, Recursion, Tower of Hanoi, Representation of Queue, Operation on Queue, Programming Queue using Array in C. Types of Queue, Applications of Stack & Queue.\n\n'
    || E'Module 5: Linked List-Part I\nDynamic Memory Allocation, Structure in C, Singly Linked List, Doubly Linked List, circular linked list.\n\n'
    || E'Module 6: Linked List-II and Applications of Linked List\nLinked implementation of Stack, Linked implementation of Queue, Applications of Linked List.\n\n'
    || E'Module 7: Trees and Graphs\nGraph Definition, Concepts, and Representation, Types of Graphs, Tree Definition, concepts, and Representation. Binary Tree, Binary Tree Traversals, conversion from general to Binary Tree. Threaded Binary Tree, Heap, Binary Search Tree. Tree for Huffman coding, 2-3 Tree, AVL tree, Breadth First Search, Depth First Search, Spanning Tree, Kruskal''s and Prim''s Minimum Cost Spanning Tree Algorithms, Dijkstra''s Shortest Path Algorithm.\n\n'
    || E'Module 8: Hashing\nThe Symbol Table Abstract Data Types, Hash Tables, Hashing Functions, Hash collision Resolution Technique, Linear Probing.\n\n'
    || E'Module 9: File Structures\nConcepts of fields, records and files, Sequential, Indexed, and Relative/Random File Organization.',
    E'Textbook:\nAn Introduction to Data Structures with Applications — Jean-Paul Tremblay, Paul G. Sorenson — Tata McGraw Hill\n\nReference Books:\nData Structures using C & C++ — Tanenbaum — Prentice-Hall\nFundamentals of Computer Algorithms — E. Horowitz, S. Sahni, and S. Rajsekaran — Galgotia Publication\nData Structures: A Pseudocode approach with C — Gilberg & Forouzan — Thomson Learning',
    '[{"sr_no":1,"name":"Introduction to Dynamic Memory Allocation","hours":2},{"sr_no":2,"name":"Implementation of Structure in C.","hours":2},{"sr_no":3,"name":"Write a program to perform Insertion sort.","hours":2},{"sr_no":4,"name":"Write a program to perform Selection sort.","hours":2},{"sr_no":5,"name":"Write a program to perform Bubble sort.","hours":2},{"sr_no":6,"name":"Write a program to perform Linear Search.","hours":2},{"sr_no":7,"name":"Write a program to perform Binary Search.","hours":2},{"sr_no":8,"name":"Write a program to implement a stack and perform push, pop operation.","hours":2},{"sr_no":9,"name":"Write a program to perform the following operations in a linear queue – Addition, Deletion, and Traversing.","hours":2},{"sr_no":10,"name":"Write a program to perform the following operations in the circular queue – Addition, Deletion, and Traversing.","hours":2},{"sr_no":11,"name":"Write a program to perform the following operations in singly linked list – Creation, Insertion, and Deletion.","hours":2},{"sr_no":12,"name":"Write a program to perform the following operations in doubly linked list – Creation, Insertion, and Deletion","hours":2},{"sr_no":13,"name":"Write a program to create a binary tree and perform – Insertion, Deletion, and Traversal.","hours":2},{"sr_no":14,"name":"Write a program to create a binary search tree and perform – Insertion, Deletion, and Traversal.","hours":2},{"sr_no":15,"name":"Write a program for traversal of graph (B.F.S., D.F.S.).","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'Object and Instance, Object-Oriented Concepts, Data types, Types of Data Structure, Abstract Data Types.', 4, 10, 1, ARRAY['1','2','4']),
   (gen_random_uuid(), subj_id, 'Array', 2, 'Array Representation, Array as an Abstract Data Type, Programming Array in C, Sparse Matrices, Sparse Representations, and its Advantages, Row-measure Order and Column-measure Order representation.', 4, 10, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Searching and Sorting', 3, 'Linear Search, Binary Search, Bubble Sort, Insertion Sort, Selection Sort, Radix sort.', 4, 10, 1, ARRAY['2','4','5']),
   (gen_random_uuid(), subj_id, 'Stack and Queue', 4, 'Stack Definition and concepts, Operations on stack, Programming Stack using Array in C, Prefix and Postfix Notations and their Compilation, Recursion, Tower of Hanoi, Representation of Queue, Operation on Queue, Programming Queue using Array in C. Types of Queue, Applications of Stack & Queue.', 7, 15, 1, ARRAY['1','2','3','4']),
   (gen_random_uuid(), subj_id, 'Linked List-Part I', 5, 'Dynamic Memory Allocation, Structure in C, Singly Linked List, Doubly Linked List, circular linked list.', 3, 5, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Linked List-II and Applications of Linked List', 6, 'Linked implementation of Stack, Linked implementation of Queue, Applications of Linked List.', 3, 8, 2, ARRAY['2','3','6']),
   (gen_random_uuid(), subj_id, 'Trees and Graphs', 7, 'Graph Definition, Concepts, and Representation, Types of Graphs, Tree Definition, concepts, and Representation. Binary Tree, Binary Tree Traversals, conversion from general to Binary Tree. Threaded Binary Tree, Heap, Binary Search Tree. Tree for Huffman coding, 2-3 Tree, AVL tree, Breadth First Search, Depth First Search, Spanning Tree, Kruskal''s and Prim''s Minimum Cost Spanning Tree Algorithms, Dijkstra''s Shortest Path Algorithm.', 12, 25, 2, ARRAY['2','4','5']),
   (gen_random_uuid(), subj_id, 'Hashing', 8, 'The Symbol Table Abstract Data Types, Hash Tables, Hashing Functions, Hash collision Resolution Technique, Linear Probing.', 4, 10, 2, ARRAY['1','2','3','6']),
   (gen_random_uuid(), subj_id, 'File Structures', 9, 'Concepts of fields, records and files, Sequential, Indexed, and Relative/Random File Organization.', 4, 7, 2, ARRAY['1','2','3','4']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Differentiate primitive and non primitive data structures.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Understand the concept of dynamic memory management.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Apply algorithm for solving problems like sorting, searching, insertion and deletion of data.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Describe the hash function and concepts of collision and its resolution methods.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 1);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SECE2120 | Programming with Python | Sem 3 | 9 modules | 4 COs
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Programming with Python', 'SECE2120', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2120 - Programming with Python\n\n'
    || E'Module 1: Introduction to Python\nHistory, Features of Python, Applications of Python, Working with Python, Input and Output Functions in Python, Variable Types, Basic Operators and Types of Data Int, Float, Complex, String, List, Tuple, Set, Dictionary and its Methods.\n\n'
    || E'Module 2: Decision Structures in Python\nConditional Blocks Using if, Else and Else If, Simple for Loops in Python, For Loop Using Ranges, String, List and Dictionaries, Use of While Loops in Python, Loop Manipulation Using Pass, Continue, Break and Else.\n\n'
    || E'Module 3: Array and Strings in Python\nArrays, Basic Strings, Accessing Strings, Basic Operations, String Slicing, Testing, Searching and Manipulating Strings, Function and Methods.\n\n'
    || E'Module 4: Dictionary, List, Tuples and Sets\nDictionaries, Accessing Values in Dictionaries, Working with Dictionaries, Properties, Functions and Methods. Sets, Accessing Values in Set, Working with Set, Properties, Functions and Methods, Tuple, Accessing Tuples, Operations, Working, Functions and Methods. List, Accessing List, Operations, Working With Lists, Function and methods, two-dimensional lists.\n\n'
    || E'Module 5: Functions, Modules and Packages in Python\nIntroduction to Functions, Defining a Function, Calling a Function, Types of Functions, Function Arguments, Anonymous Functions, Global and Local Variables, Importing Module, Math Module, Random Module, Introduction to Packages: Numpy, Pandas, Matplotlib.\n\n'
    || E'Module 6: Python Object Oriented Programming\nOOP Concept of Class, Object and Instances, Constructor, Class, Attributes, Methods, Using Properties to Control Attribute Access, and Destructors, Inheritance, Overlapping and Overloading Operators. Objects in Python: Creating Python Classes, Modules and Packages, Inheritance in Python, Polymorphism in Python.\n\n'
    || E'Module 7: Files in Python\nIntroduction to File Input and Output, Writing Data to a File, Reading Data From a File, Additional File Methods, Using Loops to Process Files, Processing Records.\n\n'
    || E'Module 8: Regular Expression in Python\nRE Module, Basic Patterns, Regular Expression Syntax, Regular Expression Object, Match Object, Search Object, Findall method, Split method, Sub Method.\n\n'
    || E'Module 9: Exception Handling in Python\nHandling IO Exceptions, Working with Directories, Metadata, Errors, Run Time Errors, The Exception Model, Exception Hierarchy, Handling Multiple Exceptions, Throwing Mechanism, Caching Mechanism.',
    E'Textbooks:\nPython Programming: A modular approach — Sheetal Taneja, Naveen Kumar — Pearson\nThink Python: How to Think Like a Computer Scientist — Allen Downey — Green Tea Press\n\nReference Book:\nPython Cookbook — David Ascher, Alex Martelli — O Reilly Media',
    '[{"sr_no":1,"name":"Introduction to Python (Introduction to IDLE, different data types, Input Output in Python, Operators, Operator precedence).","hours":4},{"sr_no":2,"name":"Working with Strings.","hours":4},{"sr_no":3,"name":"Implementation of Dictionaries, Sets, Tuples and Lists and its various methods in Python.","hours":6},{"sr_no":4,"name":"Working with decision structures in Python","hours":4},{"sr_no":5,"name":"Working with functions and modules in Python","hours":2},{"sr_no":6,"name":"Working with Object-oriented paradigms in Python","hours":4},{"sr_no":7,"name":"Implementation of file handling in Python.","hours":2},{"sr_no":8,"name":"Working with RE module in Python.","hours":2},{"sr_no":9,"name":"Exception handling in Python.","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction to Python', 1, 'History, Features of Python, Applications of Python, Working with Python, Input and Output Functions in Python, Variable Types, Basic Operators and Types of Data Int, Float, Complex, String, List, Tuple, Set, Dictionary and its Methods.', 3, 10, 1, ARRAY['1','2','4']),
   (gen_random_uuid(), subj_id, 'Decision Structures in Python', 2, 'Conditional Blocks Using if, Else and Else If, Simple for Loops in Python, For Loop Using Ranges, String, List and Dictionaries, Use of While Loops in Python, Loop Manipulation Using Pass, Continue, Break and Else.', 4, 10, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Array and Strings in Python', 3, 'Arrays, Basic Strings, Accessing Strings, Basic Operations, String Slicing, Testing, Searching and Manipulating Strings, Function and Methods.', 3, 10, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Dictionary, List, Tuples and Sets', 4, 'Dictionaries, Accessing Values in Dictionaries, Working with Dictionaries, Properties, Functions and Methods. Sets, Accessing Values in Set, Working with Set, Properties, Functions and Methods, Tuple, Accessing Tuples, Operations, Working, Functions and Methods. List, Accessing List, Operations, Working With Lists, Function and methods, two-dimensional lists.', 6, 10, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Functions, Modules and Packages in Python', 5, 'Introduction to Functions, Defining a Function, Calling a Function, Types of Functions, Function Arguments, Anonymous Functions, Global and Local Variables, Importing Module, Math Module, Random Module, Introduction to Packages: Numpy, Pandas, Matplotlib.', 7, 10, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Python Object Oriented Programming', 6, 'OOP Concept of Class, Object and Instances, Constructor, Class, Attributes, Methods, Using Properties to Control Attribute Access, and Destructors, Inheritance, Overlapping and Overloading Operators. Objects in Python: Creating Python Classes, Modules and Packages, Inheritance in Python, Polymorphism in Python.', 8, 15, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Files in Python', 7, 'Introduction to File Input and Output, Writing Data to a File, Reading Data From a File, Additional File Methods, Using Loops to Process Files, Processing Records.', 7, 15, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Regular Expression in Python', 8, 'RE Module, Basic Patterns, Regular Expression Syntax, Regular Expression Object, Match Object, Search Object, Findall method, Split method, Sub Method.', 3, 10, 2, ARRAY['3','4','5']),
   (gen_random_uuid(), subj_id, 'Exception Handling in Python', 9, 'Handling IO Exceptions, Working with Directories, Metadata, Errors, Run Time Errors, The Exception Model, Exception Hierarchy, Handling Multiple Exceptions, Throwing Mechanism, Caching Mechanism.', 4, 10, 2, ARRAY['2','3']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Interpret the fundamental python syntax, semantics and fluent in the use of python control flow statements.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Determine the methods to create and manipulate python programs by utilizing the data structures like lists, dictionaries, tuples and sets.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Articulate the object oriented programming concepts such as encapsulation, inheritance and polymorphism as used in python.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Identify the commonly used operations involving file systems and regular expressions.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO9', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SEIT2041 | Mobile Application Development | Sem 3 | 9 modules | 4 COs
-- Prerequisite: Object Oriented Programming with Java
-- NOTE: Module 5 row had blank Hours/Weightage in source; values derived from
-- the printed TOTAL (30 hrs / 100%) and flagged inline.
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Mobile Application Development', 'SEIT2041', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEIT2041 - Mobile Application Development\nPrerequisite: Object Oriented Programming with Java\n\n'
    || E'Module 1: Introduction of Android\nAndroid Operating System, History of Mobile Software Development, Open Handset Alliance (OHA), The Android Platform, Downloading and Installing Android Studio, Exploring Android SDK, Using the Command-Line Tools and the Android Emulator, Build the First Android application, Android Terminologies, Application Context, Application Tasks with Activities, Intents, and Closer Look at Android Activities.\n\n'
    || E'Module 2: Android Application Design and Resource\nAnatomy of an Android Application, Android Manifest file, Editing the Android Manifest File, Managing Application''s Identity, Enforcing Application System Requirements, Registering Activities and other Application Components, Working with Permissions.\n\n'
    || E'Module 3: Exploring User Interface Screen Elements\nIntroducing Android Views and Layouts, Displaying Text with TextView, Retrieving Data from Users, Using Buttons, Check Boxes and Radio Groups, Getting Dates and Times from Users, Using Indicators to Display and Data to Users, Adjusting Progress with SeekBar, Providing Users with Options and Context Menus, Handling User Events, Working with Dialogs, Working with Styles, Working with Themes.\n\n'
    || E'Module 4: Designing User Interfaces with Layouts\nCreating User Interfaces in Android, View versus View Group, Using Built-In Layout Classes such as Fame Layout, Linear Layout, Relative Layout, Table Layout, Multiple Layouts on a Screen, Data-Driven Containers, Organizing Screens with Tabs, Adding Scrolling Support.\n\n'
    || E'Module 5: Drawing and Working with Animation\nWorking with Canvases and Paints, Working with Text, Working with Bitmaps, Working with Shapes, Working with Animation.\n\n'
    || E'Module 6: Android Storage APIs\nWorking with Application Preferences such as Creating Private and Shared Preferences, Adding, Updating, and Deleting Preferences. Working with Files and Directories, Storing SQLite Database such as Creating an SQLite Database, Creating, Updating, and Deleting Database Records, Closing and Deleting a SQLite Database.\n\n'
    || E'Module 7: Content Providers\nExploring Android''s Content Providers, Modifying Content Providers Data, Enhancing Applications using Content Providers, acting as a Content Provider, Working with Live Folders.\n\n'
    || E'Module 8: Networking APIs / Android Web APIs / Multimedia APIs\nNetworking APIs: Understanding Mobile Networking Fundamentals, Accessing the Internet (HTTP). Android Web APIs: Browsing the Web with WebView, Building Web Extensions using WebKit, Working with Flash. Multimedia APIs: Working with Multimedia, Working with Still Images, Working with Video, Working with Audio.\n\n'
    || E'Module 9: Telephony APIs / Working with Notifications\nTelephony APIs: Working with Telephony Utilities, Using SMS, Making and Receiving Phone Calls. Working with Notifications: Notifying a User, Notifying with Status Bar, Vibrating the Phone, Blinking the Lights, Making Noise, Customizing the Notification, Designing Useful Notification.',
    E'Textbook:\nIntroduction to Android Application Development — Joseph Annuzzi Jr., Lauren Darcey, Shane Conder — Pearson Education\n\nReference Book:\nAndroid Application Development for Dummies, 3rd Edition — Donn Felker — Wiley Publication',
    '[{"sr_no":1,"name":"Create Hello World Application.","hours":2},{"sr_no":2,"name":"Create login application where you will have to validate Email ID and Password.","hours":2},{"sr_no":3,"name":"Create an application that will display toast (Message) on specific interval of Time.","hours":2},{"sr_no":4,"name":"Create an UI such that, one screen have list of all friends. On selecting of any name, next screen should show details of that friend like Name, Image, Interest, Contact details etc.","hours":4},{"sr_no":5,"name":"Create an application that will change color of the screen, based on selected options from the menu.","hours":4},{"sr_no":6,"name":"Create an application UI component: ImageButton, Togglebutton, ProgressBar","hours":4},{"sr_no":7,"name":"Create an application UI component: Spinner, DatePicker, TimePicker, SeekBar","hours":4},{"sr_no":8,"name":"Create an application UI component: Switch, RatingBar","hours":4},{"sr_no":9,"name":"Using content providers and permissions, Read phonebook contacts using content providers and display in list.","hours":4},{"sr_no":10,"name":"Create an app to send SMS and email","hours":4},{"sr_no":11,"name":"Database Connectivity","hours":4},{"sr_no":12,"name":"Create an application to make Insert, Update, Delete and Retrieve operation on the database.","hours":6},{"sr_no":13,"name":"Create an application that will play a media file from the memory card.","hours":4},{"sr_no":14,"name":"Create application using Google speech API","hours":6},{"sr_no":15,"name":"Create application using Google maps API","hours":6}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction of Android', 1, 'Android Operating System, History of Mobile Software Development, Open Handset Alliance (OHA), The Android Platform, Downloading and Installing Android Studio, Exploring Android SDK, Using the Command-Line Tools and the Android Emulator, Build the First Android application, Android Terminologies, Application Context, Application Tasks with Activities, Intents, and Closer Look at Android Activities.', 3, 5, 1, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Android Application Design and Resource', 2, 'Anatomy of an Android Application, Android Manifest file, Editing the Android Manifest File, Managing Application''s Identity, Enforcing Application System Requirements, Registering Activities and other Application Components, Working with Permissions.', 2, 5, 1, ARRAY['3','4']),
   (gen_random_uuid(), subj_id, 'Exploring User Interface Screen Elements', 3, 'Introducing Android Views and Layouts, Displaying Text with TextView, Retrieving Data from Users, Using Buttons, Check Boxes and Radio Groups, Getting Dates and Times from Users, Using Indicators to Display and Data to Users, Adjusting Progress with SeekBar, Providing Users with Options and Context Menus, Handling User Events, Working with Dialogs, Working with Styles, Working with Themes.', 2, 15, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Designing User Interfaces with Layouts', 4, 'Creating User Interfaces in Android, View versus View Group, Using Built-In Layout Classes such as Fame Layout, Linear Layout, Relative Layout, Table Layout, Multiple Layouts on a Screen, Data-Driven Containers, Organizing Screens with Tabs, Adding Scrolling Support.', 5, 15, 1, ARRAY['2','6']),
   (gen_random_uuid(), subj_id, 'Drawing and Working with Animation', 5, 'Working with Canvases and Paints, Working with Text, Working with Bitmaps, Working with Shapes, Working with Animation.', 3, 10, 1, ARRAY['2','4','6']), -- hours/weightage derived from TOTAL (row blank in source)
   (gen_random_uuid(), subj_id, 'Android Storage APIs', 6, 'Working with Application Preferences such as Creating Private and Shared Preferences, Adding, Updating, and Deleting Preferences. Working with Files and Directories, Storing SQLite Database such as Creating an SQLite Database, Creating, Updating, and Deleting Database Records, Closing and Deleting a SQLite Database.', 5, 15, 2, ARRAY['2','5']),
   (gen_random_uuid(), subj_id, 'Content Providers', 7, 'Exploring Android''s Content Providers, Modifying Content Providers Data, Enhancing Applications using Content Providers, acting as a Content Provider, Working with Live Folders.', 3, 10, 2, ARRAY['1','2','4']),
   (gen_random_uuid(), subj_id, 'Networking APIs / Android Web APIs / Multimedia APIs', 8, 'Networking APIs: Understanding Mobile Networking Fundamentals, Accessing the Internet (HTTP). Android Web APIs: Browsing the Web with WebView, Building Web Extensions using WebKit, Working with Flash. Multimedia APIs: Working with Multimedia, Working with Still Images, Working with Video, Working with Audio.', 4, 15, 2, ARRAY['2','5']),
   (gen_random_uuid(), subj_id, 'Telephony APIs / Working with Notifications', 9, 'Telephony APIs: Working with Telephony Utilities, Using SMS, Making and Receiving Phone Calls. Working with Notifications: Notifying a User, Notifying with Status Bar, Vibrating the Phone, Blinking the Lights, Making Noise, Customizing the Notification, Designing Useful Notification.', 3, 10, 2, ARRAY['4','3','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Develop user friendly mobile applications by implementing different practicals.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Understand the concepts of front end development using various technologies.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Analyse and implement frameworks, database and design patterns in mobile applications.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Create a small but realistic working mobile application using different application programming interface.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO8', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO9', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO9', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO9', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO10', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO11', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO10', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO11', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO12', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 40, 60, NULL, 200, 4);
END $$;

-- ================================================================
-- Subject: SECE2910 | Industrial Exposure | Sem 3 | 0 modules | 5 COs
-- NOTE: no theory modules. The "Outline of the Industrial Exposure" items have no
-- per-item hours in source -> stored in practicals with hours null (-- MISSING).
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Industrial Exposure', 'SECE2910', 'Engineering', 'Computer Science and Engineering', 3);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2910 - Industrial Exposure\n\n'
    || E'This is an industry-exposure course (no theory modules).\n\n'
    || E'Outline of the Industrial Exposure:\n'
    || E'1. Selection of Companies\n'
    || E'2. Company Information collection\n'
    || E'3. Report Writing\n'
    || E'4. Presentation & Question-Answer\n\n'
    || E'Course Evaluation: Actual work carried & Report Submission (50 marks); Final Presentation & Question-Answer session (50 marks).',
    E'-- MISSING: no textbooks or reference books listed in source for this course.',
    '[{"sr_no":1,"name":"Selection of Companies","hours":null},{"sr_no":2,"name":"Company Information collection","hours":null},{"sr_no":3,"name":"Report Writing","hours":null},{"sr_no":4,"name":"Presentation & Question-Answer","hours":null}]'::jsonb,
    NULL);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Study, analysis and describe about the surrounding industrial environment.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Describe use of advanced tools and techniques industry.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Connect with industrial personnel and follow engineering practices and discipline prescribed in industry.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Develop awareness about general workplace behavior and build interpersonal and team skills.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Prepare professional work reports and presentations.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO6', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 1),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 1),(gen_random_uuid(), subj_id, 'CO5', 'PSO3', 1);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, NULL, NULL, 100, NULL, NULL, 100, 2);
END $$;

-- ================================================================
-- Subject: SESH2051 | Mathematical Methods for Computation | Sem 4 | 6 modules | 5 COs
-- Prerequisite: Elementary Mathematics for Engineers (SESH1010)
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Mathematical Methods for Computation', 'SESH2051', 'Engineering', 'Computer Science and Engineering', 4);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SESH2051 - Mathematical Methods for Computation\nPrerequisite: Elementary Mathematics for Engineers (SESH1010)\n\n'
    || E'Module 1: Ordinary Differential Equation\nFirst order ODEs, Formation of differential equations, Solution of differential equation, Solution of equations in separable form, Exact first order ODEs, Linear first order ODEs, Bernoulli Equation, ODEs of Second and Higher order, Homogeneous linear ODEs, Linear Dependence and Independence of Solutions, Homogeneous linear ODEs with constant coefficients, Differential Operators, Nonhomogeneous ODEs, Undetermined Coefficients, Variation of Parameters.\n\n'
    || E'Module 2: Partial Differential Equation\nFormation of First and Second order equations, Solution of First order equations, Linear and Non-liner equations of first, Higher order equations with constant coefficients, Complementary function, Particular Integrals.\n\n'
    || E'Module 3: Laplace Transform\nLaplace Transform, Linearity, First Shifting Theorem, Existence Theorem, Transforms of Derivatives and Integrals, Unit Step Function, Second Shifting Theorem, Dirac''s Delta function, Laplace Transformation of Periodic function, Inverse Laplace transform, Convolution.\n\n'
    || E'Module 4: Fourier Series & Fourier Integral\nPeriodic function, Euler Formula, Arbitrary Period, Even and Odd function, Half-Range Expansions, Applications to ODEs, Representation by Fourier Integral, Fourier Cosine Integral, Fourier Sine Integral.\n\n'
    || E'Module 5: Basics of Statistics\nElements, Variables, Observations, Quantitative and Qualitative data, Corss-sectional and Time series data, Frequency distribution, Dot plot, Histogram, Cumulative distribution, Measure of location, Mean, Median, Mode, Percentile, Quartile, Measure of variability, Range, Interquartile Range, Variance, Standard Deviation, Coefficient of Variation, Regression Analysis, Regression line and regression coefficient, Karl Pearson''s method.\n\n'
    || E'Module 6: Probability Distribution\nIntroduction, Conditional probability, Independent events, independent experiments, Theorem of total probability and Bayes'' theorem, Probability distribution, Binomial distribution, Poisson distribution, Uniform distribution, Normal distribution.',
    E'Textbooks:\nAdvanced Engineering Mathematics — Erwin Kreyszig — Wiley India Pvt. Ltd. New Delhi\nProbability and Statistics for Engineers — Richard A. Johnson, Irwin Miller, John Freund — Pearson India Education Services Pvt. Ltd., Noida\n\nReference Books:\nHigher Engineering Mathematics — B. S. Grewal — Khanna Publishers, New Delhi\nAdvanced Engineering Mathematics — R. K. Jain, S.R.K. Iyengar — Narosa Publishing House New Delhi\nDifferential Equations for Dummies — Steven Holzner — Wiley India Pvt. Ltd., New Delhi\nHigher Engineering Mathematics — H.K. Dass, Er. Rajnish Verma — S. Chand & Company Ltd., New Delhi',
    '[{"sr_no":1,"name":"Ordinary Differential Equation-1","hours":2},{"sr_no":2,"name":"Ordinary Differential Equation-2","hours":2},{"sr_no":3,"name":"Ordinary Differential Equation-3","hours":4},{"sr_no":4,"name":"Partial Differential Equation-1","hours":2},{"sr_no":5,"name":"Partial Differential Equation-2","hours":4},{"sr_no":6,"name":"Laplace Transform","hours":2},{"sr_no":7,"name":"Fourier Series-1","hours":2},{"sr_no":8,"name":"Fourier Series-2","hours":2},{"sr_no":9,"name":"Basics of Statistics-1","hours":2},{"sr_no":10,"name":"Basics of Statistics-2","hours":4},{"sr_no":11,"name":"Probability-1","hours":2},{"sr_no":12,"name":"Probability-2","hours":2}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Ordinary Differential Equation', 1, 'First order ODEs, Formation of differential equations, Solution of differential equation, Solution of equations in separable form, Exact first order ODEs, Linear first order ODEs, Bernoulli Equation, ODEs of Second and Higher order, Homogeneous linear ODEs, Linear Dependence and Independence of Solutions, Homogeneous linear ODEs with constant coefficients, Differential Operators, Nonhomogeneous ODEs, Undetermined Coefficients, Variation of Parameters.', 10, 20, 1, ARRAY['1','2','3','5']),
   (gen_random_uuid(), subj_id, 'Partial Differential Equation', 2, 'Formation of First and Second order equations, Solution of First order equations, Linear and Non-liner equations of first, Higher order equations with constant coefficients, Complementary function, Particular Integrals.', 7, 18, 1, ARRAY['1','2','4','5']),
   (gen_random_uuid(), subj_id, 'Laplace Transform', 3, 'Laplace Transform, Linearity, First Shifting Theorem, Existence Theorem, Transforms of Derivatives and Integrals, Unit Step Function, Second Shifting Theorem, Dirac''s Delta function, Laplace Transformation of Periodic function, Inverse Laplace transform, Convolution.', 6, 12, 1, ARRAY['1','2','4','5']),
   (gen_random_uuid(), subj_id, 'Fourier Series & Fourier Integral', 4, 'Periodic function, Euler Formula, Arbitrary Period, Even and Odd function, Half-Range Expansions, Applications to ODEs, Representation by Fourier Integral, Fourier Cosine Integral, Fourier Sine Integral.', 7, 15, 2, ARRAY['1','2','3','4','5']),
   (gen_random_uuid(), subj_id, 'Basics of Statistics', 5, 'Elements, Variables, Observations, Quantitative and Qualitative data, Corss-sectional and Time series data, Frequency distribution, Dot plot, Histogram, Cumulative distribution, Measure of location, Mean, Median, Mode, Percentile, Quartile, Measure of variability, Range, Interquartile Range, Variance, Standard Deviation, Coefficient of Variation, Regression Analysis, Regression line and regression coefficient, Karl Pearson''s method.', 7, 15, 2, ARRAY['1','2','3','4','5']),
   (gen_random_uuid(), subj_id, 'Probability Distribution', 6, 'Introduction, Conditional probability, Independent events, independent experiments, Theorem of total probability and Bayes'' theorem, Probability distribution, Binomial distribution, Poisson distribution, Uniform distribution, Normal distribution.', 8, 20, 2, ARRAY['1','2','3','4','5']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Describe 1st and 2nd order odes and pdes.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Classify differential equations and evaluate linear & non linear partial differential equations.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Apply laplace transform as a tool which are used to evaluate differential equation and fourier integral representation.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Elaborate analysis of categorial data and quantitative data.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Adapt the knowledge of various probability distribution and their applications in mathematical models, sport stragies and insurance.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 3),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 3),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 1);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 1);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, NULL, NULL, 50, 150, 5);
END $$;

-- ================================================================
-- Subject: SECE2040 | Computer Organization | Sem 4 | 7 modules | 4 COs
-- BTL NOTE: source BTL table has 9 rows incl. extra "Micro-programmed Control" and
-- "Multiprocessors"; btl mapped to the 7 content modules by name/topic.
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Computer Organization', 'SECE2040', 'Engineering', 'Computer Science and Engineering', 4);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE2040 - Computer Organization\n\n'
    || E'Module 1: Basic Computer Organization and Design\nInstruction codes, Computer registers, computer instructions Timing and Control, Instruction cycle Memory-Reference Instructions, Input-output and interrupt, Complete computer description, Design of Basic computer, Design of Accumulator Unit.\n\n'
    || E'Module 2: Programming the Basic Computer\nIntroduction Machine Language, Assembly Language the Assembler, Program loops, Programming Arithmetic and logic operations, subroutines, I-O Programming.\n\n'
    || E'Module 3: Computer Arithmetic\nIntroduction, Addition and subtraction, Multiplication and Division Algorithms, Floating Point Arithmetic.\n\n'
    || E'Module 4: Central Processing Unit\nIntroduction, General Register Organization, Stack Organization, Instruction format, Addressing Modes, data transfer and manipulation, Program Control, Reduced Instruction Set Computer (RISC).\n\n'
    || E'Module 5: Pipeline and Vector Processing\nFlynn''s taxonomy, Parallel Processing, Pipelining, Arithmetic Pipeline, Instruction, Pipeline, RISC Pipeline, Vector Processing, Array Processors.\n\n'
    || E'Module 6: Input-Output Organization\nInput-Output Interface, Asynchronous Data Transfer, Modes of Transfer, Priority Interrupt, DMA, Input-Output Processor (IOP), CPU-IOP Communication, Serial communication.\n\n'
    || E'Module 7: Memory Organization\nMemory Hierarchy, Main Memory, Auxiliary Memory, Associative Memory, Cache Memory, Virtual Memory.',
    E'Textbooks:\nComputer System Architecture — M. Morris Mano — Pearson\nStructured Computer Organization, 6th Edition — Andrew S. Tanenbaum and Todd Austin — PHI\n\nReference Books:\nComputer Architecture & Organization — M. Murdocca & V. Heuring — WILEY\nComputer Architecture and Organization — John Hayes — McGrawHill',
    '[{"sr_no":1,"name":"Study basics of Computer Organization","hours":4},{"sr_no":2,"name":"Study and implement programs on number system","hours":8},{"sr_no":3,"name":"Study and implement programs on conversion and","hours":4},{"sr_no":4,"name":"Study and build different circuits using Logisim.","hours":14}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Basic Computer Organization and Design', 1, 'Instruction codes, Computer registers, computer instructions Timing and Control, Instruction cycle Memory-Reference Instructions, Input-output and interrupt, Complete computer description, Design of Basic computer, Design of Accumulator Unit.', 6, 15, 1, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'Programming the Basic Computer', 2, 'Introduction Machine Language, Assembly Language the Assembler, Program loops, Programming Arithmetic and logic operations, subroutines, I-O Programming.', 5, 8, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Computer Arithmetic', 3, 'Introduction, Addition and subtraction, Multiplication and Division Algorithms, Floating Point Arithmetic.', 6, 12, 1, ARRAY['2','4','5']),
   (gen_random_uuid(), subj_id, 'Central Processing Unit', 4, 'Introduction, General Register Organization, Stack Organization, Instruction format, Addressing Modes, data transfer and manipulation, Program Control, Reduced Instruction Set Computer (RISC).', 6, 15, 1, ARRAY['1','2','5']),
   (gen_random_uuid(), subj_id, 'Pipeline and Vector Processing', 5, 'Flynn''s taxonomy, Parallel Processing, Pipelining, Arithmetic Pipeline, Instruction, Pipeline, RISC Pipeline, Vector Processing, Array Processors.', 8, 20, 2, ARRAY['2','5']),
   (gen_random_uuid(), subj_id, 'Input-Output Organization', 6, 'Input-Output Interface, Asynchronous Data Transfer, Modes of Transfer, Priority Interrupt, DMA, Input-Output Processor (IOP), CPU-IOP Communication, Serial communication.', 6, 15, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Memory Organization', 7, 'Memory Hierarchy, Main Memory, Auxiliary Memory, Associative Memory, Cache Memory, Virtual Memory.', 8, 15, 2, ARRAY['2','5','6']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Describe the design and working of basic components used to build computer system.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Visualize and understand the working of cpu, different instruction formats, addressing modes, pipeline and vector processing and evaluate the performance of pipeline approach.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Describe the requirements of different memories and evaluate memory management techniques.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Examine the working mechanism of input and output devices and information transfer.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO9', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO9', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO10', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO11', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 3);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SECE3011 | Computer Network | Sem 4 | 7 modules | 4 COs
-- Prerequisite: Operating System (SEIT2031)
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Computer Network', 'SECE3011', 'Engineering', 'Computer Science and Engineering', 4);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SECE3011 - Computer Network\nPrerequisite: Operating System (SEIT2031)\n\n'
    || E'Module 1: Introduction\nOverview of network and data communication, Data Communications, Computer Networking, Protocols and Standards, types of Network, Network Topology, Protocol hierarchies, and design issues of layers, Interfaces, and services. Reference Model: The OSI reference model, TCP/IP reference model, network standards.\n\n'
    || E'Module 2: Physical Layer\nData and transmission techniques, Multiplexing, Transmission media, Asynchronous Communication, Wireless transmission, ISDN, ATM, Cellular Radio, Switching techniques issues.\n\n'
    || E'Module 3: Data Link Layer\nLayer design issues, services provided to network layers, Framing, Error control, and Flow control, Data link control and protocols – Simplex protocol, Sliding window protocol.\n\n'
    || E'Module 4: Medium Access Sub Layer\nChannel Allocations, Multiple Access protocols- ALOHA, CSMA, CSMA/CD protocols, Collision-free protocols, Limited contention protocols, LAN architectures, IEEE 802 and OSI, Ethernet (CSMA/CD), Bus, Token Ring, DQDB, FDDI, Bridges and recent developments.\n\n'
    || E'Module 5: Network Layer\nA network Layer design issue, Routing algorithms, and protocols, Congestion Control Algorithms, Internetworking, Addressing, N/W Layer Protocols and recent developments.\n\n'
    || E'Module 6: Transport Layer\nTransport services, Design issues, transport layer protocols, Congestion Control, QOS and its improvement.\n\n'
    || E'Module 7: Application Layer\nClient-Server Model, DNS, SMTP, FTP, HTTP, WWW, and recent development.',
    E'Textbook:\nData Communication and Networking — Behrouz A. Forouzan — Tata McGraw Hill\n\nReference Books:\nComputer Networks — Andrew S Tanenbaum — PHI Learning\nData and Computer Communications — William Stallings — Prentice Hall\nTCP/IP Illustrated Volume-I — Kevin R. Fall, W. Richard Stevens — Addition Wesley\nInternetworking with TCP/IP Volume-I — Douglas E. Comer — PHI',
    '[{"sr_no":1,"name":"Implement Packet Generation having information of packet number (2-dig), Total no of packets (2 dig), & data itself in the packet.","hours":8},{"sr_no":2,"name":"Implementation flow control algorithms, CRC, VRC, LRC","hours":6},{"sr_no":3,"name":"Implement CSMA/CD between two machines","hours":6},{"sr_no":4,"name":"Implement Token ring between 3 machines.","hours":6},{"sr_no":5,"name":"Study of switches, Hubs, Routers, and gateway.","hours":4}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'Overview of network and data communication, Data Communications, Computer Networking, Protocols and Standards, types of Network, Network Topology, Protocol hierarchies, and design issues of layers, Interfaces, and services. Reference Model: The OSI reference model, TCP/IP reference model, network standards.', 4, 10, 1, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'Physical Layer', 2, 'Data and transmission techniques, Multiplexing, Transmission media, Asynchronous Communication, Wireless transmission, ISDN, ATM, Cellular Radio, Switching techniques issues.', 7, 15, 1, ARRAY['1','2','4']),
   (gen_random_uuid(), subj_id, 'Data Link Layer', 3, 'Layer design issues, services provided to network layers, Framing, Error control, and Flow control, Data link control and protocols – Simplex protocol, Sliding window protocol.', 7, 15, 1, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'Medium Access Sub Layer', 4, 'Channel Allocations, Multiple Access protocols- ALOHA, CSMA, CSMA/CD protocols, Collision-free protocols, Limited contention protocols, LAN architectures, IEEE 802 and OSI, Ethernet (CSMA/CD), Bus, Token Ring, DQDB, FDDI, Bridges and recent developments.', 5, 10, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Network Layer', 5, 'A network Layer design issue, Routing algorithms, and protocols, Congestion Control Algorithms, Internetworking, Addressing, N/W Layer Protocols and recent developments.', 8, 20, 2, ARRAY['2','3','6']),
   (gen_random_uuid(), subj_id, 'Transport Layer', 6, 'Transport services, Design issues, transport layer protocols, Congestion Control, QOS and its improvement.', 6, 15, 2, ARRAY['2','4']),
   (gen_random_uuid(), subj_id, 'Application Layer', 7, 'Client-Server Model, DNS, SMTP, FTP, HTTP, WWW, and recent development.', 8, 15, 2, ARRAY['2','5']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Distinguish the working of network protocols, application and osi reference model and tcp/ip reference model.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Explain various service provided by computer network and its uses.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Describe concept of network interface and performance issues in the networks.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Evaluate network tools for implementing network protocols.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO8', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SEIT2031 | Operating System | Sem 4 | 7 modules | 4 COs
-- Prerequisite: Programming for Problem Solving (SECE1050)
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Operating System', 'SEIT2031', 'Engineering', 'Computer Science and Engineering', 4);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEIT2031 - Operating System\nPrerequisite: Programming for Problem Solving (SECE1050)\n\n'
    || E'Module 1: Introduction\nWhat is OS? History of OS, Types of OS, Concepts of OS.\n\n'
    || E'Module 2: Processes and Threads Management\nProcess Concept, process state, process control block, CPU Scheduling: CPU-I/O burst cycle, types of schedulers, context switch, Preemptive Scheduling, Dispatcher, Scheduling criteria; Scheduling algorithms: FCFS, SJF, Priority scheduling, Round-Robin scheduling, Multilevel queue scheduling; Threads, Types of Threads, Multithreading.\n\n'
    || E'Module 3: Inter Process Communication\nRace Conditions, Critical Regions, Mutual exclusion with busy waiting, sleep and wakeup, semaphores, mutexes, monitors, message passing, barriers; Classical IPC Problems: The dining philosopher problem, The readers and writers problem.\n\n'
    || E'Module 4: Deadlocks\nResources, Conditions for Deadlocks, Deadlock modelling, The ostrich algorithm, Deadlock detection and recovery, Deadlock avoidance, Deadlock prevention, Other issues: Two-phase locking, Communication deadlocks, live locks, starvation.\n\n'
    || E'Module 5: Memory Management\nMain memory: Background, Swapping, Contiguous memory allocation, Segmentation, Paging, Structure of page table, Virtual memory: Background, Demand paging, copy-on write, Page Replacement Algorithms: Optimal page replacement, not recently used, FIFO, second chance page replacement, LRU; Allocation of frames, Thrashing.\n\n'
    || E'Module 6: File Management\nIntroduction; Files: naming, structure, types, access, attributes, operations; Directories: single level, hierarchical, path names, directory operations; File Allocation Methods: Contiguous Allocation, Linked Allocation, Indexed Allocation.\n\n'
    || E'Module 7: Disk Management\nDisk structure, Disk arm Scheduling Algorithms: FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; Disk Free Space Management, RAID.',
    E'Textbooks:\nOperating System Principles — Silberschatz A., Galvin P. and Gagne G — Wiley\nModern Operating System — Andrew S. Tanenbaum — Pearson\n\nReference Books:\nOperating Systems: Internals and Design Principles — William Stallings — Pearson\nUNIX and Shell Programming — Behrouz A. Forouzan, Richard F. Gilberg — Cengage Learning\nOperating Systems — Dhamdhere D. M — Tata McGraw Hill',
    '[{"sr_no":1,"name":"Study of basic commands of Linux.","hours":2},{"sr_no":2,"name":"Study of Advance commands and filters of Linux/UNIX.","hours":2},{"sr_no":3,"name":"Write shell scripts to perform several computations like add numbers, subtract numbers, find average, percentage. Also find factorial of a given number. Generate Fibonacci series etc.","hours":4},{"sr_no":4,"name":"Simulate CPU scheduling algorithms. (E.g. FCFS, SJF, Round Robin etc.)","hours":6},{"sr_no":5,"name":"Simulate contiguous memory allocation techniques. (E.g. Worst-fit, Best-fit, Next-fit, First-fit).","hours":4},{"sr_no":6,"name":"Simulate banker''s algorithm for deadlock avoidance.","hours":4},{"sr_no":7,"name":"Simulate page replacement algorithms. (E.g. FIFO, LRU, Optimal)","hours":4},{"sr_no":8,"name":"Simulate disk scheduling algorithms. (E.g. FCFS,SCAN,C-SCAN)","hours":4}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction', 1, 'What is OS? History of OS, Types of OS, Concepts of OS.', 2, 6, 1, ARRAY['1','2','4']),
   (gen_random_uuid(), subj_id, 'Processes and Threads Management', 2, 'Process Concept, process state, process control block, CPU Scheduling: CPU-I/O burst cycle, types of schedulers, context switch, Preemptive Scheduling, Dispatcher, Scheduling criteria; Scheduling algorithms: FCFS, SJF, Priority scheduling, Round-Robin scheduling, Multilevel queue scheduling; Threads, Types of Threads, Multithreading.', 10, 20, 1, ARRAY['1','2','3','5','6']),
   (gen_random_uuid(), subj_id, 'Inter Process Communication', 3, 'Race Conditions, Critical Regions, Mutual exclusion with busy waiting, sleep and wakeup, semaphores, mutexes, monitors, message passing, barriers; Classical IPC Problems: The dining philosopher problem, The readers and writers problem.', 6, 14, 1, ARRAY['2','3','4','5']),
   (gen_random_uuid(), subj_id, 'Deadlocks', 4, 'Resources, Conditions for Deadlocks, Deadlock modelling, The ostrich algorithm, Deadlock detection and recovery, Deadlock avoidance, Deadlock prevention, Other issues: Two-phase locking, Communication deadlocks, live locks, starvation.', 4, 10, 1, ARRAY['2','3','4','6']),
   (gen_random_uuid(), subj_id, 'Memory Management', 5, 'Main memory: Background, Swapping, Contiguous memory allocation, Segmentation, Paging, Structure of page table, Virtual memory: Background, Demand paging, copy-on write, Page Replacement Algorithms: Optimal page replacement, not recently used, FIFO, second chance page replacement, LRU; Allocation of frames, Thrashing.', 12, 25, 2, ARRAY['1','2','3','4','6']),
   (gen_random_uuid(), subj_id, 'File Management', 6, 'Introduction; Files: naming, structure, types, access, attributes, operations; Directories: single level, hierarchical, path names, directory operations; File Allocation Methods: Contiguous Allocation, Linked Allocation, Indexed Allocation.', 6, 13, 2, ARRAY['1','2','3']),
   (gen_random_uuid(), subj_id, 'Disk Management', 7, 'Disk structure, Disk arm Scheduling Algorithms: FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; Disk Free Space Management, RAID.', 5, 12, 2, ARRAY['1','2','3','4','5']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Understand the basic principles of operating system.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Illustrate the concepts of operating systems services and its components.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Evaluate the performance of operating system algorithms.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Apply various operating system algorithms on real life problems.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO8', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO9', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO10', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO11', 3);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO3', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 3),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 3);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, 20, 30, NULL, 150, 4);
END $$;

-- ================================================================
-- Subject: SEIT3010 | Software Engineering | Sem 4 | 10 modules | 5 COs
-- Prerequisite: Basics of Object-Oriented Programming and UML
-- ================================================================
DO $$
DECLARE subj_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO subjects (id, name, code, department, branch, semester)
  VALUES (subj_id, 'Software Engineering', 'SEIT3010', 'Engineering', 'Computer Science and Engineering', 4);

  INSERT INTO subject_content (id, subject_id, content, reference_books, practicals, created_by)
  VALUES (gen_random_uuid(), subj_id,
    E'Course: SEIT3010 - Software Engineering\nPrerequisite: Basics of Object-Oriented Programming and UML\n\n'
    || E'Module 1: Introduction to Software Engineering\nStudy of Different Models, Software Characteristics Components, Applications, Layered Technologies, Processes, Methods and Tools, Generic View of Software Engineering, Process Models- Waterfall model, Incremental, Evolutionary process models- Prototype, Spiral, and Concurrent Development Model.\n\n'
    || E'Module 2: Requirements Engineering\nProblem Recognition, Requirement Engineering tasks, Processes, Requirements Specification, Use cases, and Functional specification, Requirements validation, Requirements Analysis, Modeling – different types.\n\n'
    || E'Module 3: Structured System Design\nDesign Concepts, Design Model, Software Architecture, Data Design, Architectural Styles and Patterns, Architectural Design, Alternative architectural designs, Modeling Component level design and its modeling, Procedural Design, Object Oriented Design.\n\n'
    || E'Module 4: User Interface Design\nConcepts of UI, Interface Design Model, Internal and External Design, Evaluation, Interaction, and Information Display Software.\n\n'
    || E'Module 5: Planning a Software Project\nScope and Feasibility, Effort Estimation, Schedule and staffing, Quality Planning, Risk management- identification, assessment, control, project monitoring plan, Detailed Scheduling.\n\n'
    || E'Module 6: Quality Assurance\nQuality Control, Assurance, Cost, Reviews, Software Quality Assurance, Approaches to SQA, Reliability, Quality Standards- ISO9000 and 9001.\n\n'
    || E'Module 7: Coding and Unit Testing\nProgramming principles and guidelines, Programming practices, Coding standards, Incremental development of code, Management of code evaluation, Unit testing- procedural units, classes, Code Inspection, Metrics – size measure, complexity metrics, Cyclomatic Complexity, Halstead measure, Knot Count, Comparison of Different Metrics.\n\n'
    || E'Module 8: Testing\nConcepts, Psychology of testing, Levels of testing, Testing Process- test plan, test case design, Execution, Black-Box testing – Boundary value analysis – Pairwise testing- state-based testing, White-Box testing – criteria and test case generation and tool support, Metrics – Coverage analysis- reliability.\n\n'
    || E'Module 9: Software Project Management\nManagement Spectrum, People –Product – Process- Project, W5HH Principle, Importance of Team Management.\n\n'
    || E'Module 10: Case Tools and Study\nIntroduction to CASE Building Blocks of CASE, Integrated CASE Environment.',
    E'Textbooks:\nFundamentals of Software Engineering — Rajib Mall — PHI Learning\nSoftware engineering: A Practitioner''s Approach — Roger Pressman — McGraw Hill Education\n\nReference Books:\nSoftware Engineering – An Engineering Approach — James F. Peters & Witold Pedrycz — Wiley\nSoftware Engineering – Principles and Practice — Waman Jawadekar — McGraw Hill Education',
    '[{"sr_no":1,"name":"To identify the role of the software in today''s world across a few significant domains related to day to day life.","hours":1},{"sr_no":2,"name":"To identify the problem related to software crisis for a given scenario.","hours":1},{"sr_no":3,"name":"To identify the suitable software development model for the given scenario.","hours":1},{"sr_no":4,"name":"To identify the various requirement development activities viz. elicitation, analysis, specification and verification for the given scenarios.","hours":1},{"sr_no":5,"name":"To identify the various elicitation techniques and their usage for the Banking case study.","hours":1},{"sr_no":6,"name":"To classify the requirement into functional and non-functional requirements.","hours":1},{"sr_no":7,"name":"Identify the elements in software Requirements Specification document.","hours":1},{"sr_no":8,"name":"To verify the requirements against the quality attributes.","hours":1},{"sr_no":9,"name":"Identify the elements and relationship by analyzing the class diagram of Shop Retail Application case study.","hours":1},{"sr_no":10,"name":"Identify the design principle that is being violated in relation to the given scenario.","hours":1},{"sr_no":11,"name":"To identify the usage of stubs or drivers in the context of an integration testing scenario.","hours":1},{"sr_no":12,"name":"Identify the different types of performance testing.","hours":1},{"sr_no":13,"name":"To identify the usage of regression testing.","hours":1},{"sr_no":14,"name":"To understand usage of software metrics.","hours":1},{"sr_no":15,"name":"Project Work: Understand importance of SDLC approach & various processes.","hours":1}]'::jsonb,
    NULL);

  INSERT INTO modules (id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels) VALUES
   (gen_random_uuid(), subj_id, 'Introduction to Software Engineering', 1, 'Study of Different Models, Software Characteristics Components, Applications, Layered Technologies, Processes, Methods and Tools, Generic View of Software Engineering, Process Models- Waterfall model, Incremental, Evolutionary process models- Prototype, Spiral, and Concurrent Development Model.', 7, 15, 1, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Requirements Engineering', 2, 'Problem Recognition, Requirement Engineering tasks, Processes, Requirements Specification, Use cases, and Functional specification, Requirements validation, Requirements Analysis, Modeling – different types.', 6, 15, 1, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'Structured System Design', 3, 'Design Concepts, Design Model, Software Architecture, Data Design, Architectural Styles and Patterns, Architectural Design, Alternative architectural designs, Modeling Component level design and its modeling, Procedural Design, Object Oriented Design.', 5, 5, 1, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'User Interface Design', 4, 'Concepts of UI, Interface Design Model, Internal and External Design, Evaluation, Interaction, and Information Display Software.', 2, 5, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Planning a Software Project', 5, 'Scope and Feasibility, Effort Estimation, Schedule and staffing, Quality Planning, Risk management- identification, assessment, control, project monitoring plan, Detailed Scheduling.', 3, 10, 1, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Quality Assurance', 6, 'Quality Control, Assurance, Cost, Reviews, Software Quality Assurance, Approaches to SQA, Reliability, Quality Standards- ISO9000 and 9001.', 4, 10, 2, ARRAY['1','2']),
   (gen_random_uuid(), subj_id, 'Coding and Unit Testing', 7, 'Programming principles and guidelines, Programming practices, Coding standards, Incremental development of code, Management of code evaluation, Unit testing- procedural units, classes, Code Inspection, Metrics – size measure, complexity metrics, Cyclomatic Complexity, Halstead measure, Knot Count, Comparison of Different Metrics.', 7, 15, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Testing', 8, 'Concepts, Psychology of testing, Levels of testing, Testing Process- test plan, test case design, Execution, Black-Box testing – Boundary value analysis – Pairwise testing- state-based testing, White-Box testing – criteria and test case generation and tool support, Metrics – Coverage analysis- reliability.', 7, 15, 2, ARRAY['2','3','4']),
   (gen_random_uuid(), subj_id, 'Software Project Management', 9, 'Management Spectrum, People –Product – Process- Project, W5HH Principle, Importance of Team Management.', 2, 5, 2, ARRAY['2','3']),
   (gen_random_uuid(), subj_id, 'Case Tools and Study', 10, 'Introduction to CASE Building Blocks of CASE, Integrated CASE Environment.', 2, 5, 2, ARRAY['3','4','5']);

  INSERT INTO course_outcomes (id, subject_id, co_code, description) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'Cite the process of requirement gathering, classification, specification and validation in software engineering process.'),
   (gen_random_uuid(), subj_id, 'CO2', 'Demonstrate an ability to design the software by applying the software engineering design principles.'),
   (gen_random_uuid(), subj_id, 'CO3', 'Discover system design patterns, agile methodologies for development of software using uml and scrum.'),
   (gen_random_uuid(), subj_id, 'CO4', 'Devise project planning, cost estimation, quality management techniques.'),
   (gen_random_uuid(), subj_id, 'CO5', 'Assess software testing process to analyze the functionality of application.');

  INSERT INTO co_po_mapping (id, subject_id, co_code, po_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO1', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO3', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO1', 'PO5', 1),(gen_random_uuid(), subj_id, 'CO1', 'PO6', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO2', 'PO4', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO2', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO2', 'PO7', 1),
   (gen_random_uuid(), subj_id, 'CO3', 'PO1', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO3', 3),(gen_random_uuid(), subj_id, 'CO3', 'PO4', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO3', 'PO6', 1),(gen_random_uuid(), subj_id, 'CO3', 'PO7', 1),
   (gen_random_uuid(), subj_id, 'CO4', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO4', 'PO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO5', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO6', 2),(gen_random_uuid(), subj_id, 'CO4', 'PO7', 3),(gen_random_uuid(), subj_id, 'CO4', 'PO8', 1),
   (gen_random_uuid(), subj_id, 'CO5', 'PO1', 1),(gen_random_uuid(), subj_id, 'CO5', 'PO2', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO3', 2),(gen_random_uuid(), subj_id, 'CO5', 'PO4', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO5', 3),(gen_random_uuid(), subj_id, 'CO5', 'PO6', 2);

  INSERT INTO co_pso_mapping (id, subject_id, co_code, pso_code, strength) VALUES
   (gen_random_uuid(), subj_id, 'CO1', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO1', 'PSO2', 1),
   (gen_random_uuid(), subj_id, 'CO2', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO2', 'PSO2', 2),
   (gen_random_uuid(), subj_id, 'CO3', 'PSO1', 3),(gen_random_uuid(), subj_id, 'CO3', 'PSO2', 3),
   (gen_random_uuid(), subj_id, 'CO4', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO2', 2),(gen_random_uuid(), subj_id, 'CO4', 'PSO3', 2),
   (gen_random_uuid(), subj_id, 'CO5', 'PSO1', 2),(gen_random_uuid(), subj_id, 'CO5', 'PSO2', 2);

  INSERT INTO exam_scheme (id, subject_id, theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits)
  VALUES (gen_random_uuid(), subj_id, 40, 60, NULL, NULL, 50, 150, 4);
END $$;

COMMIT;

-- ================================================================
-- EXTRACTION SUMMARY
-- Total subjects extracted: 22
-- Total modules: 127
-- Total COs: 96
-- Subjects by semester: Sem 1: 4, Sem 2: 6, Sem 3: 7, Sem 4: 5
-- Module-less (lab/workshop/exposure) subjects: SESH1240, SEIT1010, SEME1020,
--   SECE2021, SECE2910
-- Flagged ambiguities / data notes:
--   * CO-PO and CO-PSO strengths assigned to consecutive PO/PSO columns from
--     PO1/PSO1 (source matrix column alignment lost in PDF extraction).
--   * BTL drift (mapped by module name; some modules have no BTL row):
--       SESH1080 (Fourier Series -> empty), SESH1210 (Solid State Physics and
--       DC/AC Circuits -> empty), SEME1040, SECE2040.
--   * SEIT2041 Module 5 Hours/Weightage blank in source -> derived from TOTAL.
--   * SECE2910 Industrial Exposure: outline items have no hours -> null;
--     no textbooks/reference books listed in source.
--   * Subjects with tutorials (no practicals) store the tutorial list in
--     subject_content.practicals: SESH1070, SESH1080, SESH2040, SESH2051, SEIT3010.
--   * Some CO-PO/PSO source tables list a CO row with no matching CO outcome
--     (e.g. SESH1080, SESH2040 CO5) -> those orphan rows were omitted.
-- ================================================================

