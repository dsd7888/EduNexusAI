 "use client";
 
 import { createBrowserClient } from "@/lib/db/supabase-browser";
 import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
 } from "@/components/ui/alert-dialog";
 import { Button } from "@/components/ui/button";
 import {
   Card,
   CardContent,
   CardDescription,
   CardHeader,
   CardTitle,
 } from "@/components/ui/card";
 import { Input } from "@/components/ui/input";
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from "@/components/ui/select";
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from "@/components/ui/table";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Textarea } from "@/components/ui/textarea";
 import { Loader2, Trash2 } from "lucide-react";
 import { useCallback, useEffect, useMemo, useState } from "react";
 import { toast } from "sonner";
 
 type Branch = "chem" | "mech";
 
 interface SubjectRow {
   id: string;
   code: string;
   name: string;
   department: string;
   branch: string;
   semester: number;
 }
 
 interface ModuleRow {
   id: string;
   subject_id: string;
   module_number: number;
   name: string;
   description: string | null;
 }
 
 export default function SubjectsPage() {
   const [tab, setTab] = useState<"subjects" | "modules">("subjects");
 
   const [subjects, setSubjects] = useState<SubjectRow[]>([]);
   const [modules, setModules] = useState<ModuleRow[]>([]);
   const [loadingSubjects, setLoadingSubjects] = useState(false);
   const [loadingModules, setLoadingModules] = useState(false);
   const [saving, setSaving] = useState(false);
 
   // Subjects form
   const [name, setName] = useState("");
   const [code, setCode] = useState("");
   const [department, setDepartment] = useState("");
   const [branch, setBranch] = useState<Branch | "">("");
   const [semester, setSemester] = useState("");
 
   // Modules tab state
   const [selectedSubjectId, setSelectedSubjectId] = useState("");
   const selectedSubject = useMemo(
     () => subjects.find((s) => s.id === selectedSubjectId) ?? null,
     [subjects, selectedSubjectId]
   );
 
   // Modules form
   const [moduleNumber, setModuleNumber] = useState("");
   const [moduleName, setModuleName] = useState("");
   const [moduleDescription, setModuleDescription] = useState("");
 
   // Confirm dialog
   const [confirmOpen, setConfirmOpen] = useState(false);
   const [confirmPayload, setConfirmPayload] = useState<
     | { kind: "subject"; id: string; label: string }
     | { kind: "module"; id: string; label: string }
     | null
   >(null);
 
   const fetchSubjects = useCallback(async () => {
     setLoadingSubjects(true);
     try {
       const supabase = createBrowserClient();
       const { data, error } = await supabase
         .from("subjects")
         .select("id, code, name, department, branch, semester")
         .order("code");
       if (error) {
         toast.error(error.message);
         setSubjects([]);
         return;
       }
       setSubjects((data ?? []) as SubjectRow[]);
     } finally {
       setLoadingSubjects(false);
     }
   }, []);
 
   const fetchModules = useCallback(async (subjectId: string) => {
     if (!subjectId) {
       setModules([]);
       return;
     }
     setLoadingModules(true);
     try {
       const supabase = createBrowserClient();
       const { data, error } = await supabase
         .from("modules")
         .select("id, subject_id, module_number, name, description")
         .eq("subject_id", subjectId)
         .order("module_number");
       if (error) {
         toast.error(error.message);
         setModules([]);
         return;
       }
       setModules((data ?? []) as ModuleRow[]);
     } finally {
       setLoadingModules(false);
     }
   }, []);
 
   useEffect(() => {
     fetchSubjects();
   }, [fetchSubjects]);
 
   useEffect(() => {
     if (tab === "modules") {
       fetchModules(selectedSubjectId);
     }
   }, [tab, selectedSubjectId, fetchModules]);
 
   const handleAddSubject = async () => {
     if (!name.trim() || !code.trim() || !department.trim() || !branch || !semester) {
       toast.error("Please fill all required fields");
       return;
     }
     const sem = Number(semester);
     if (Number.isNaN(sem) || sem < 1 || sem > 8) {
       toast.error("Semester must be 1-8");
       return;
     }
 
     setSaving(true);
     try {
       const res = await fetch("/api/subjects/manage", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           type: "subject",
           action: "create",
           data: {
             name: name.trim(),
             code: code.trim().toUpperCase(),
             department: department.trim(),
             branch,
             semester: sem,
           },
         }),
       });
       const json = await res.json().catch(() => ({}));
       if (!res.ok) {
         toast.error(json.error ?? "Failed to add subject");
         return;
       }
       toast.success("Subject added");
       setName("");
       setCode("");
       setDepartment("");
       setBranch("");
       setSemester("");
       await fetchSubjects();
     } catch {
       toast.error("Failed to add subject");
     } finally {
       setSaving(false);
     }
   };
 
   const handleAddModule = async () => {
     if (!selectedSubjectId) {
       toast.error("Please select a subject");
       return;
     }
     if (!moduleNumber || !moduleName.trim()) {
       toast.error("Please fill all required fields");
       return;
     }
     const num = Number(moduleNumber);
     if (Number.isNaN(num) || num < 1 || num > 10) {
       toast.error("Module number must be 1-10");
       return;
     }
 
     setSaving(true);
     try {
       const res = await fetch("/api/subjects/manage", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           type: "module",
           action: "create",
           data: {
             subjectId: selectedSubjectId,
             moduleNumber: num,
             name: moduleName.trim(),
             description: moduleDescription.trim() || null,
           },
         }),
       });
       const json = await res.json().catch(() => ({}));
       if (!res.ok) {
         toast.error(json.error ?? "Failed to add module");
         return;
       }
       toast.success("Module added");
       setModuleNumber("");
       setModuleName("");
       setModuleDescription("");
       await fetchModules(selectedSubjectId);
     } catch {
       toast.error("Failed to add module");
     } finally {
       setSaving(false);
     }
   };
 
   const askDeleteSubject = (s: SubjectRow) => {
     setConfirmPayload({
       kind: "subject",
       id: s.id,
       label: `${s.code} ${s.name}`,
     });
     setConfirmOpen(true);
   };
 
   const askDeleteModule = (m: ModuleRow) => {
     setConfirmPayload({
       kind: "module",
       id: m.id,
       label: `Module ${m.module_number}: ${m.name}`,
     });
     setConfirmOpen(true);
   };
 
   const handleConfirmDelete = async () => {
     if (!confirmPayload) return;
 
     setSaving(true);
     try {
       const res = await fetch("/api/subjects/manage", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           type: confirmPayload.kind,
           action: "delete",
           data:
             confirmPayload.kind === "subject"
               ? { subjectId: confirmPayload.id }
               : { moduleId: confirmPayload.id },
         }),
       });
       const json = await res.json().catch(() => ({}));
       if (!res.ok) {
         toast.error(json.error ?? "Delete failed");
         return;
       }
       toast.success("Deleted");
       setConfirmOpen(false);
       setConfirmPayload(null);
       await fetchSubjects();
       if (selectedSubjectId) {
         await fetchModules(selectedSubjectId);
       }
     } catch {
       toast.error("Delete failed");
     } finally {
       setSaving(false);
     }
   };
 
   return (
     <div className="space-y-6">
       <div>
         <h1 className="text-2xl font-semibold tracking-tight">Subjects & Modules</h1>
         <p className="text-muted-foreground text-sm">
           Manage subjects and modules for the pilot.
         </p>
       </div>
 
       <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
         <TabsList>
           <TabsTrigger value="subjects">Subjects</TabsTrigger>
           <TabsTrigger value="modules">Modules</TabsTrigger>
         </TabsList>
 
         <TabsContent value="subjects" className="mt-6 space-y-6">
           <Card>
             <CardHeader>
               <CardTitle>Add Subject</CardTitle>
               <CardDescription>Create a new subject.</CardDescription>
             </CardHeader>
             <CardContent className="grid gap-4 sm:grid-cols-2">
               <div className="space-y-2">
                 <label className="text-sm font-medium">Name</label>
                 <Input value={name} onChange={(e) => setName(e.target.value)} />
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-medium">Code</label>
                 <Input
                   value={code}
                   onChange={(e) => setCode(e.target.value.toUpperCase())}
                   placeholder="ME301"
                 />
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-medium">Department</label>
                 <Input
                   value={department}
                   onChange={(e) => setDepartment(e.target.value)}
                 />
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-medium">Branch</label>
                 <Select value={branch} onValueChange={(v) => setBranch(v as Branch)}>
                   <SelectTrigger className="w-full">
                     <SelectValue placeholder="Select branch" />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="chem">chem</SelectItem>
                     <SelectItem value="mech">mech</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
               <div className="space-y-2">
                 <label className="text-sm font-medium">Semester</label>
                 <Input
                   type="number"
                   min={1}
                   max={8}
                   value={semester}
                   onChange={(e) => setSemester(e.target.value)}
                 />
               </div>
               <div className="flex items-end">
                 <Button className="w-full sm:w-auto" onClick={handleAddSubject} disabled={saving}>
                   {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                   Add Subject
                 </Button>
               </div>
             </CardContent>
           </Card>
 
           <Card>
             <CardHeader>
               <CardTitle>All Subjects</CardTitle>
               <CardDescription>Existing subjects.</CardDescription>
             </CardHeader>
             <CardContent>
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead>Code</TableHead>
                     <TableHead>Name</TableHead>
                     <TableHead>Department</TableHead>
                     <TableHead>Branch</TableHead>
                     <TableHead>Semester</TableHead>
                     <TableHead className="w-[80px]">Actions</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {loadingSubjects ? (
                     <TableRow>
                       <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                         Loading...
                       </TableCell>
                     </TableRow>
                   ) : subjects.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                         No subjects yet.
                       </TableCell>
                     </TableRow>
                   ) : (
                     subjects.map((s) => (
                       <TableRow key={s.id}>
                         <TableCell className="font-medium">{s.code}</TableCell>
                         <TableCell>{s.name}</TableCell>
                         <TableCell>{s.department}</TableCell>
                         <TableCell>{s.branch}</TableCell>
                         <TableCell>{s.semester}</TableCell>
                         <TableCell>
                           <Button
                             variant="ghost"
                             size="icon"
                             className="h-8 w-8 text-destructive hover:text-destructive"
                             onClick={() => askDeleteSubject(s)}
                             disabled={saving}
                             aria-label="Delete subject"
                           >
                             <Trash2 className="size-4" />
                           </Button>
                         </TableCell>
                       </TableRow>
                     ))
                   )}
                 </TableBody>
               </Table>
             </CardContent>
           </Card>
         </TabsContent>
 
         <TabsContent value="modules" className="mt-6 space-y-6">
           <Card>
             <CardHeader>
               <CardTitle>Manage Modules</CardTitle>
               <CardDescription>Select a subject, then add/remove modules.</CardDescription>
             </CardHeader>
             <CardContent className="space-y-6">
               <div className="space-y-2">
                 <label className="text-sm font-medium">Subject</label>
                 <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                   <SelectTrigger className="w-full">
                     <SelectValue placeholder="Select subject" />
                   </SelectTrigger>
                   <SelectContent>
                     {subjects.map((s) => (
                       <SelectItem key={s.id} value={s.id}>
                         {s.name} ({s.code})
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
 
               <Card>
                 <CardHeader>
                   <CardTitle>Add Module</CardTitle>
                   <CardDescription>
                     {selectedSubject
                       ? `Adding to ${selectedSubject.name} (${selectedSubject.code})`
                       : "Pick a subject first."}
                   </CardDescription>
                 </CardHeader>
                 <CardContent className="grid gap-4 sm:grid-cols-2">
                   <div className="space-y-2">
                     <label className="text-sm font-medium">Module Number</label>
                     <Input
                       type="number"
                       min={1}
                       max={10}
                       value={moduleNumber}
                       onChange={(e) => setModuleNumber(e.target.value)}
                       disabled={!selectedSubjectId}
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-sm font-medium">Name</label>
                     <Input
                       value={moduleName}
                       onChange={(e) => setModuleName(e.target.value)}
                       disabled={!selectedSubjectId}
                     />
                   </div>
                   <div className="space-y-2 sm:col-span-2">
                     <label className="text-sm font-medium">Description (optional)</label>
                     <Textarea
                       value={moduleDescription}
                       onChange={(e) => setModuleDescription(e.target.value)}
                       disabled={!selectedSubjectId}
                     />
                   </div>
                   <div className="sm:col-span-2">
                     <Button onClick={handleAddModule} disabled={saving || !selectedSubjectId}>
                       {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                       Add Module
                     </Button>
                   </div>
                 </CardContent>
               </Card>
 
               <Card>
                 <CardHeader>
                   <CardTitle>Modules</CardTitle>
                   <CardDescription>
                     {selectedSubject ? "Modules for selected subject." : "Select a subject to view modules."}
                   </CardDescription>
                 </CardHeader>
                 <CardContent>
                   <Table>
                     <TableHeader>
                       <TableRow>
                         <TableHead className="w-[60px]">#</TableHead>
                         <TableHead>Name</TableHead>
                         <TableHead>Description</TableHead>
                         <TableHead className="w-[80px]">Actions</TableHead>
                       </TableRow>
                     </TableHeader>
                     <TableBody>
                       {!selectedSubjectId ? (
                         <TableRow>
                           <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                             Select a subject to see modules.
                           </TableCell>
                         </TableRow>
                       ) : loadingModules ? (
                         <TableRow>
                           <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                             Loading...
                           </TableCell>
                         </TableRow>
                       ) : modules.length === 0 ? (
                         <TableRow>
                           <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                             No modules yet.
                           </TableCell>
                         </TableRow>
                       ) : (
                         modules.map((m) => (
                           <TableRow key={m.id}>
                             <TableCell className="font-medium">{m.module_number}</TableCell>
                             <TableCell>{m.name}</TableCell>
                             <TableCell className="max-w-[520px] truncate">
                               {m.description ?? "—"}
                             </TableCell>
                             <TableCell>
                               <Button
                                 variant="ghost"
                                 size="icon"
                                 className="h-8 w-8 text-destructive hover:text-destructive"
                                 onClick={() => askDeleteModule(m)}
                                 disabled={saving}
                                 aria-label="Delete module"
                               >
                                 <Trash2 className="size-4" />
                               </Button>
                             </TableCell>
                           </TableRow>
                         ))
                       )}
                     </TableBody>
                   </Table>
                 </CardContent>
               </Card>
             </CardContent>
           </Card>
         </TabsContent>
       </Tabs>
 
       <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
         <AlertDialogContent>
           <AlertDialogHeader>
             <AlertDialogTitle>Confirm delete</AlertDialogTitle>
             <AlertDialogDescription>
               Are you sure you want to delete{" "}
               <span className="font-medium">{confirmPayload?.label}</span>?
             </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter>
             <AlertDialogCancel onClick={() => setConfirmPayload(null)}>
               Cancel
             </AlertDialogCancel>
             <AlertDialogAction
               onClick={handleConfirmDelete}
               className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
             >
               Delete
             </AlertDialogAction>
           </AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
     </div>
   );
 }
