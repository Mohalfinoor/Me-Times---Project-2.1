import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Moon, Sun, X, Trash2, Clock, Calendar as CalendarIcon, ChevronLeft, ChevronRight, LogIn, LogOut, User as UserIcon, UserPlus, Check, XCircle, Bell, Users, Zap, Eye, EyeOff, PieChart, Globe, LayoutGrid, ExternalLink, Edit2 } from 'lucide-react';
import { auth, db, signInWithGoogle, logOut, handleFirestoreError, OperationType, testConnection } from './Firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, setDoc, or, arrayUnion, getDocs, getDoc } from 'firebase/firestore';
import { TimeRangeSlider } from './components/TimeRangeSlider';

// --- Types ---
const DEFAULT_SCHEDULE: GroupScheduleItem[] = [];

interface Task {
  id: string;
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  color: string;
  type: 'mission' | 'assignment';
  // Assignment specific fields
  category?: 'Kelompok' | 'Individu' | 'Lainnya';
  taskLink?: string;
  submissionLink?: string;
  status: 'Sudah Dikumpul' | 'Belum Dikumpul' | 'Dalam Proses';
  myNote?: string;
  ownerUid: string;
  ownerEmail?: string;
  creatorName?: string;
  collaborators?: string[];
  recurrence?: 'none' | 'weekly' | 'monthly';
  recurrenceId?: string;
  groupId?: string;
  createdAt: any;
  updatedAt?: any;
  isSchedule?: boolean;
  groupName?: string;
  originalIndex?: number;
}

interface UserTaskState {
  id: string;
  taskId: string;
  userId: string;
  status: 'Sudah Dikumpul' | 'Belum Dikumpul' | 'Dalam Proses';
  myNote?: string;
  updatedAt?: any;
}

interface Group {
  id: string;
  name: string;
  code: string;
  scheduleTitle?: string;
  creatorUid: string;
  admins: string[]; // User IDs with administrative rights
  members: string[]; // All User IDs
  createdAt: any;
  schedule?: GroupScheduleItem[];
}

interface GroupScheduleItem {
  id: string;
  day: string;
  subject: string;
  modality: 'Online' | 'Offline';
  startTime: string;
  endTime: string;
  lecturers: string[];
  hasAssignment: boolean;
  sks: number;
  duration: string;
  originalIndex?: number;
}

const COLORS = [
  '#88a771', '#4f6b3b', '#9fa290', 
  '#d4c19c', '#cb9b97', '#6b8e8f'
];

// --- Helpers ---
const formatDate = (date: Date) => {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
};

const isHoliday = (date: Date) => {
  const day = date.getDay();
  // Saturday (6) and Sunday (0) are holidays
  return day === 0 || day === 6;
};

const timeToMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const calculateDuration = (start: string, end: string) => {
  if (!start || !end) return '0:00';
  const startMins = timeToMinutes(start);
  const endMins = timeToMinutes(end);
  let diff = endMins - startMins;
  if (diff < 0) diff += 1440; // Handle overnight crossing
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};

const isTimeNight = (startTime: string) => {
  if (!startTime) return false;
  const parts = startTime.split(':');
  if (parts.length >= 1) {
    const hours = parseInt(parts[0], 10);
    if (!isNaN(hours)) {
      return hours >= 18 || hours < 6;
    }
  }
  return false;
};

const getTimeColor = (time: string) => {
  return '#ffffff'; // Solid white card backgrounds for clean high-contrast styling
};

const getTaskBackground = (task: Task) => {
  return getTimeColor(task.startTime);
};

const getTaskTextColor = (task: Task, isNight: boolean) => {
  return '#18181b'; // Dark text for uniform readability on white-glass background
};

const getAngle = (minutes: number) => {
  // Standard clock: 12:00 is at the top (0 degrees)
  // 720 minutes in 12 hours
  const angle = (minutes % 720) * 0.5; // 360 degrees / 720 minutes = 0.5 deg/min
  return angle;
};

const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
  // Handle overlapping arcs or arcs crossing 0/360 boundary
  let actualEnd = endAngle;
  if (endAngle < startAngle) actualEnd += 360;

  const startRad = (startAngle - 90) * Math.PI / 180.0;
  const endRad = (actualEnd - 90) * Math.PI / 180.0;

  const start = {
    x: x + (radius * Math.cos(startRad)),
    y: y + (radius * Math.sin(startRad))
  };
  const end = {
    x: x + (radius * Math.cos(endRad)),
    y: y + (radius * Math.sin(endRad))
  };

  const largeArcFlag = actualEnd - startAngle <= 180 ? "0" : "1";

  return [
    "M", x, y,
    "L", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 1, end.x, end.y,
    "Z"
  ].join(" ");
};


export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [syncedUserGroupIds, setSyncedUserGroupIds] = useState<string[]>([]);

  // Listen to the user's document in Firestore to stay 100% in sync with their userProfile 'groupIds'
  useEffect(() => {
    if (!user) {
      setSyncedUserGroupIds([]);
      return;
    }
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const userData = snapshot.data();
        setSyncedUserGroupIds(userData.groupIds || []);
      }
    }, (error) => {
      console.warn("User document license check failed:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Initial Boot
  useEffect(() => {
    testConnection();
  }, []);
  const [ownedTasks, setOwnedTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem('loop_tasks');
      return saved ? JSON.parse(saved).filter((t: any) => t.ownerUid === 'guest') : [];
    } catch {
      return [];
    }
  });
  const [collabTasks, setCollabTasks] = useState<Task[]>([]);
  const [groupTasksState, setGroupTasksState] = useState<Task[]>([]);
  const [personalTaskStates, setPersonalTaskStates] = useState<UserTaskState[]>([]);

  const tasks = useMemo(() => {
    const combined = [...ownedTasks, ...collabTasks, ...groupTasksState];
    const unique = combined.filter((v, i, a) => v.id && a.findIndex(t => t.id === v.id) === i);
    
    // Merge personal states (status/note) into group tasks
    return unique.map(task => {
      const personal = personalTaskStates.find(ps => ps.taskId === task.id);
      if (personal) {
        return {
          ...task,
          status: personal.status,
          myNote: personal.myNote || task.myNote
        };
      }
      return task;
    });
  }, [ownedTasks, collabTasks, groupTasksState, personalTaskStates]);

  // Persist guest tasks to localStorage
  useEffect(() => {
    try {
      const guestTasks = ownedTasks.filter(t => t.ownerUid === 'guest');
      // Deep copy to remove any potential non-serializable properties or circular refs
      const cleanTasks = JSON.parse(JSON.stringify(guestTasks, (key, value) => {
        // If we somehow got a function or symbol or complex internal object, skip it
        if (typeof value === 'function' || typeof value === 'symbol') return undefined;
        return value;
      }));
      localStorage.setItem('loop_tasks', JSON.stringify(cleanTasks));
    } catch (err) {
      console.error('Failed to sync guest tasks to local storage:', err);
    }
  }, [ownedTasks]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Task OwnerEmail Self-Repair
  useEffect(() => {
    if (!user || tasks.length === 0) return;
    
    const repairTasks = async () => {
      const tasksToRepair = tasks.filter(t => t.ownerUid === user.uid && !t.ownerEmail);
      if (tasksToRepair.length === 0) return;
      
      console.log(`Self-repairing ${tasksToRepair.length} tasks with ownerEmail...`);
      for (const t of tasksToRepair) {
        try {
          await updateDoc(doc(db, 'tasks', t.id), { ownerEmail: user.email });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `tasks/${t.id}`);
        }
      }
    };
    
    repairTasks();
  }, [user, tasks.length]);

  // Group Task Repair: Add missing group members as collaborators when owner logs in
  useEffect(() => {
    if (!user || tasks.length === 0 || groups.length === 0) return;
    
    const repairGroupTasks = async () => {
      // Only repair tasks I own
      const myGroupTasks = tasks.filter(t => t.type === 'assignment' && t.groupId && t.ownerUid === user.uid);
      if (myGroupTasks.length === 0) return;

      for (const task of myGroupTasks) {
        const group = groups.find(g => g.id === task.groupId);
        if (group) {
          const members = group.members || [];
          const missingMembers = members.filter(m => !(task.collaborators || []).includes(m));
          if (missingMembers.length > 0) {
            const updatedCollaborators = Array.from(new Set([...(task.collaborators || []), ...members]));
            try {
              await updateDoc(doc(db, 'tasks', task.id), { collaborators: updatedCollaborators });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
            }
          }
        }
      }
    };
    
    repairGroupTasks();
  }, [user, groups, tasks.length]);

  const updateTaskProgress = async (taskId: string, status: string, myNote?: string) => {
    if (!user) {
      // Guest mode
      setOwnedTasks(prev => prev.map(t => t.id === taskId ? { 
        ...t, 
        status: status as any, 
        myNote: myNote !== undefined ? myNote : t.myNote,
        updatedAt: new Date().toISOString() 
      } : t));
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Use personal state for group missions or assignments I don't own
    if (task.groupId || task.ownerUid !== user.uid) {
      const stateId = `${user.uid}_${taskId}`;
      try {
        await setDoc(doc(db, 'userTaskStates', stateId), {
          taskId,
          userId: user.uid,
          status,
          myNote: myNote !== undefined ? myNote : (task.myNote || ''),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'user-task-states');
      }
    } else {
      // Individual task owned by me, update the task doc directly
      try {
        const updateData: any = {
          status,
          updatedAt: serverTimestamp()
        };
        if (myNote !== undefined) updateData.myNote = myNote;
        await updateDoc(doc(db, 'tasks', taskId), updateData);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'tasks');
      }
    }
  };

  const getPilotDisplay = (task: Task) => {
    if (task.ownerUid === user?.uid) return 'SAYA';
    return task.creatorName || 'Pilot';
  };

  // Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync groupIds to User document for high-performance rules
  useEffect(() => {
    if (!user) return;
    
    const syncUserGroups = async () => {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef).catch(() => null);
      const currentGroupIds = groups.map(g => g.id);
      
      let needsUpdate = true;
      if (userSnap && userSnap.exists()) {
        const userData = userSnap.data();
        const currentGroupsInDoc = userData.groupIds || [];
        
        const sortedDoc = [...currentGroupsInDoc].sort().join(',');
        const sortedState = [...currentGroupIds].sort().join(',');
        
        if (sortedDoc === sortedState) {
          needsUpdate = false;
        }
      }
      
      if (needsUpdate) {
        try {
          await setDoc(userRef, {
            groupIds: currentGroupIds,
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          }, { merge: true });
        } catch (e) {
          console.error("Failed to sync groupIds to user profile", e);
        }
      }
    };
    
    syncUserGroups();
  }, [user, groups]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Ensure user profile exists in Firestore
        try {
          await setDoc(doc(db, 'users', u.uid), {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
            lastLogin: serverTimestamp()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
        }
      } else {
        // If logged out, reload guest tasks from localStorage
        const saved = localStorage.getItem('loop_tasks');
        if (saved) {
          const localTasks = JSON.parse(saved).filter((t: any) => t.ownerUid === 'guest');
          setOwnedTasks(localTasks);
          setCollabTasks([]);
          setGroupTasksState([]);
          setPersonalTaskStates([]);
        } else {
          setOwnedTasks([]);
          setCollabTasks([]);
          setGroupTasksState([]);
          setPersonalTaskStates([]);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Groups Listener
  useEffect(() => {
    if (!user) {
      setGroups([]);
      return;
    }
    const q = query(collection(db, 'groups'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const gs: Group[] = [];
      snapshot.forEach(doc => gs.push({ ...doc.data() as Group, id: doc.id }));
      setGroups(gs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'groups'));
    return () => unsubscribe();
  }, [user]);

  // Repair Group Schedule IDs
  useEffect(() => {
    if (!user || groups.length === 0) return;
    
    const repairSchedules = async () => {
      // Find groups that have schedule items without IDs
      const groupsToRepair = groups.filter(g => g.schedule && g.schedule.some(i => !i.id));
      if (groupsToRepair.length === 0) return;

      for (const group of groupsToRepair) {
        if (!group.schedule) continue;
        const repairedSchedule = group.schedule.map((item, idx) => {
          if (!item.id) {
            return {
              ...item,
              id: `sched_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`
            };
          }
          return item;
        });
        
        try {
          await updateDoc(doc(db, 'groups', group.id), {
            schedule: repairedSchedule,
            updatedAt: serverTimestamp()
          });
          console.log(`Repaired schedule IDs for group ${group.id}`);
        } catch (e) {
          console.error("Failed to repair schedule IDs:", e);
        }
      }
    };
    
    repairSchedules();
  }, [groups, user]);

  // Tasks Listener
  useEffect(() => {
    if (!user) {
      // For guest users, we keep the local tasks
      return;
    }
    
    // If logged in, fetch from Firestore. 
    // KEEP guest tasks in ownedTasks, but clear other states
    setCollabTasks([]);
    setGroupTasksState([]);
    setPersonalTaskStates([]);
    
    const unsubs: (() => void)[] = [];

    // Personal Task States Listener (Independent progress for group tasks)
    const qStates = query(collection(db, 'userTaskStates'), where('userId', '==', user.uid));
    unsubs.push(onSnapshot(qStates, (s) => {
      setPersonalTaskStates(s.docs.map(doc => ({ ...doc.data() as UserTaskState, id: doc.id })));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'user-task-states')));

    // Query 1: Tasks I own
    const q1 = query(collection(db, 'tasks'), where('ownerUid', '==', user.uid));
    unsubs.push(onSnapshot(q1, (s) => {
      const firestoreTasks = s.docs.map(doc => ({ ...doc.data() as Task, id: doc.id }));
      setOwnedTasks(prev => {
        const guestTasks = prev.filter(t => t.ownerUid === 'guest');
        return [...guestTasks, ...firestoreTasks];
      });
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'tasks-owned')));

    // Query 2: Tasks where I'm a collaborator
    const q2 = query(collection(db, 'tasks'), where('collaborators', 'array-contains', user.uid));
    unsubs.push(onSnapshot(q2, (s) => {
      setCollabTasks(s.docs.map(doc => ({ ...doc.data() as Task, id: doc.id })));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'tasks-collab')));

    // Query 3: Tasks matching user's groups (querying per group to satisfy Firestore list security rules statically)
    // We only subscribe to groups that have fully synced down to the user's groupIds array in Firestore.
    const verifiedGroups = groups.filter(g => syncedUserGroupIds.includes(g.id));
    if (verifiedGroups.length > 0) {
      const groupTasksMap = new Map<string, Task[]>();
      verifiedGroups.forEach(group => {
        const qG = query(collection(db, 'tasks'), where('groupId', '==', group.id));
        const unsubG = onSnapshot(qG, (s) => {
          const tasksForGroup = s.docs.map(doc => ({ ...doc.data() as Task, id: doc.id }));
          groupTasksMap.set(group.id, tasksForGroup);
          
          // Flatten all group tasks and update state
          const allGroupTasks: Task[] = [];
          groupTasksMap.forEach(tasksList => {
            allGroupTasks.push(...tasksList);
          });
          
          // Remove potential duplicates
          const uniqueGroupTasks = Array.from(
            new Map(allGroupTasks.map(task => [task.id, task])).values()
          );
          setGroupTasksState(uniqueGroupTasks);
        }, (e) => {
          console.error(`Error loading group tasks for group ${group.id}:`, e);
          // Let's pass the error to handleFirestoreError if they don't have access or similar (but handled gracefully)
        });
        unsubs.push(unsubG);
      });
    }

    return () => unsubs.forEach(unsub => unsub());
  }, [user, groups, syncedUserGroupIds]);

  const isNight = false;
  // Auto-detect clock night mode: 18:00 to 06:00
  const [isClockNight, setIsClockNight] = useState(() => {
    const hours = new Date().getHours();
    return hours >= 18 || hours < 6;
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignmentFormOpen, setIsAssignmentFormOpen] = useState(false);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showChronologicalView, setShowChronologicalView] = useState(true);
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'recap' | 'social'>('dashboard');
  const [groupViewTab, setGroupViewTab] = useState<'tasks' | 'schedule' | 'members'>('tasks');
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [isEditingScheduleTitle, setIsEditingScheduleTitle] = useState(false);
  const [tempScheduleTitle, setTempScheduleTitle] = useState('');
  const [editingScheduleItem, setEditingScheduleItem] = useState<GroupScheduleItem | null>(null);
  const [editingScheduleIdx, setEditingScheduleIdx] = useState<number | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set());
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [confirmingGroupAction, setConfirmingGroupAction] = useState<{ groupId: string, type: 'leave' | 'delete' } | null>(null);
  const [isGroupActionLoading, setIsGroupActionLoading] = useState(false);
  
  const selectedTaskDetails = React.useMemo(() => {
    if (!selectedTaskId) return null;
    const task = tasks.find(t => t.id === selectedTaskId);
    if (task) return task;

    // Search in groups for schedule items if not found in missions
    for (const group of groups) {
      if (!group.schedule) continue;
      const index = group.schedule.findIndex(s => {
        const sid = s.id || `schedule-${group.id}-${s.subject}-${s.startTime}`;
        return sid === selectedTaskId;
      });
      if (index !== -1) {
        const item = group.schedule[index];
        return {
          ...item,
          id: selectedTaskId,
          title: item.subject,
          type: 'mission',
          color: '#678850',
          ownerUid: 'system',
          date: formatDate(selectedDate),
          isSchedule: true,
          groupId: group.id,
          groupName: group.name,
          originalIndex: index,
          description: `Mata kuliah di grup ${group.name}. Modality: ${item.modality || '-'}. Dosen: ${item.lecturers?.join(', ') || '-'}. Duration: ${item.duration || '-'}. SKS: ${item.sks || '-'}`
        } as any;
      }
    }
    return null;
  }, [tasks, groups, selectedTaskId, selectedDate]);

  const isAnyModalOpen = isFormOpen || isAssignmentFormOpen || showFullCalendar || !!selectedTaskDetails || showAllTasks || (isScheduleModalOpen && !!editingScheduleItem) || !!confirmingGroupAction || !!taskToDelete;

  const canEditTask = (task: Task | null) => {
    if (!task) return false;
    if (task.isSchedule) {
      if (task.groupId) {
        const group = groups.find(g => g.id === task.groupId);
        if (group) {
          const isGroupOwner = !user || group.creatorUid === user?.uid;
          const isGroupAdmin = group.admins?.includes(user?.uid || '');
          if (isGroupOwner || isGroupAdmin) return true;
        }
      }
      return false;
    }
    // Jika tidak login, bisa edit mission tamu
    if (!user) return task.ownerUid === 'guest';
    // Jika login, bisa edit milik sendiri atau mission tamu di memori
    if (task.ownerUid === user.uid || task.ownerUid === 'guest') return true;
    
    // If it's a group task, group owner and group admins can also edit it
    if (task.groupId) {
      const group = groups.find(g => g.id === task.groupId);
      if (group) {
        const isGroupOwner = group.creatorUid === user.uid;
        const isGroupAdmin = group.admins?.includes(user.uid);
        if (isGroupOwner || isGroupAdmin) return true;
      }
    }
    return false;
  };

  const canDeleteTask = (task: Task | null) => {
    if (!task) return false;
    if (task.isSchedule) {
      if (task.groupId) {
        const group = groups.find(g => g.id === task.groupId);
        if (group) {
          const isGroupOwner = !user || group.creatorUid === user?.uid;
          const isGroupAdmin = group.admins?.includes(user?.uid || '');
          if (isGroupOwner || isGroupAdmin) return true;
        }
      }
      return false;
    }
    if (!user) return task.ownerUid === 'guest';
    if (task.ownerUid === user.uid || task.ownerUid === 'guest') return true;
    
    if (task.groupId) {
      const group = groups.find(g => g.id === task.groupId);
      if (group) {
        const isGroupOwner = group.creatorUid === user.uid;
        const isGroupAdmin = group.admins?.includes(user.uid);
        if (isGroupOwner || isGroupAdmin) return true;
      }
    }
    return false;
  };

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    date: formatDate(new Date()),
    startTime: '09:00',
    endTime: '11:00',
    color: COLORS[0],
    tagEmail: '',
    recurrence: 'none' as 'none' | 'weekly' | 'monthly'
  });

  const [newAssignment, setNewAssignment] = useState({
    title: '',
    description: '',
    date: formatDate(new Date()),
    startTime: '00:00',
    endTime: '23:59',
    color: COLORS[1],
    category: 'Individu' as const,
    taskLink: '',
    submissionLink: '',
    status: 'Belum Dikumpul' as const,
    myNote: '',
    groupId: ''
  });

  const scheduleSuggestions = useMemo(() => {
    if (!newAssignment.groupId) return [];
    const group = groups.find(g => g.id === newAssignment.groupId);
    if (!group || !group.schedule) return [];
    return Array.from(new Set(group.schedule.map(item => item.subject))).sort();
  }, [newAssignment.groupId, groups]);

  const toggleTaskVisibility = (taskId: string) => {
    setHiddenTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupName.trim()) return;

    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const groupRef = doc(collection(db, 'groups'));
      await setDoc(groupRef, {
        id: groupRef.id,
        name: groupName.trim(),
        code: code,
        creatorUid: user.uid,
        admins: [user.uid], // Creator is the first admin
        members: [user.uid],
        createdAt: serverTimestamp()
      });
      // Sync user profile
      await updateDoc(doc(db, 'users', user.uid), {
        groupIds: arrayUnion(groupRef.id)
      });
      setGroupName('');
      alert(`Group established! Frequency: ${code}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groups');
    }
  };

  const promoteToAdmin = async (groupId: string, memberUid: string) => {
    if (!user) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    // Check if current user is owner or admin
    const isOwner = group.creatorUid === user.uid;
    const isAdmin = group.admins?.includes(user.uid);
    
    if (!isOwner && !isAdmin) {
      alert("Requires administrative clearance.");
      return;
    }

    try {
      await updateDoc(doc(db, 'groups', groupId), {
        admins: arrayUnion(memberUid)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groups');
    }
  };

  const demoteAdmin = async (groupId: string, adminUid: string) => {
    if (!user) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    // Only owner can demote admins
    if (group.creatorUid !== user.uid) {
      alert("Only the Group Leader (Owner) can revoke administrative clearance.");
      return;
    }

    if (adminUid === group.creatorUid) return; // Cannot demote owner

    try {
      await updateDoc(doc(db, 'groups', groupId), {
        admins: (group.admins || []).filter(uid => uid !== adminUid)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groups');
    }
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !joinCode.trim()) return;

    try {
      const q = query(collection(db, 'groups'), where('code', '==', joinCode.trim().toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert('Invalid access code.');
        return;
      }

      const groupDoc = querySnapshot.docs[0];
      const groupData = groupDoc.data() as Group;

      if (groupData.members?.includes(user.uid)) {
        alert('Active link already established with this squadron.');
        return;
      }

      await updateDoc(doc(db, 'groups', groupDoc.id), {
        members: arrayUnion(user.uid)
      });
      // Sync user profile
      await updateDoc(doc(db, 'users', user.uid), {
        groupIds: arrayUnion(groupDoc.id)
      });
      setJoinCode('');
      alert(`${groupData.name} squadron synchronization complete!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'groups');
    }
  };

  const leaveGroup = async (groupId: string) => {
    if (!user) return;
    try {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      setIsGroupActionLoading(true);

      // If owner leaves, delete group immediately as requested
      if (group.creatorUid === user.uid) {
        await deleteGroup(groupId);
        setIsGroupActionLoading(false);
        setConfirmingGroupAction(null);
        return;
      }

      const updatedMembers = (group.members || []).filter(m => m !== user.uid);
      try {
        if (updatedMembers.length === 0) {
          await deleteDoc(doc(db, 'groups', groupId));
        } else {
          await updateDoc(doc(db, 'groups', groupId), {
            members: updatedMembers,
            updatedAt: serverTimestamp()
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `groups/${groupId}`);
      }

      // Sync user profile
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const currentGroups = userSnap.data().groupIds || [];
          await updateDoc(userRef, {
            groupIds: currentGroups.filter((id: string) => id !== groupId)
          });
        }
      } catch (err) {
        console.warn("User profile sync failed:", err);
      }

      setViewingGroupId(null);
      setConfirmingGroupAction(null);
    } catch (error) {
      console.error("Error leaving group:", error);
      alert("Gagal keluar dari grup.");
    } finally {
      setIsGroupActionLoading(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!user) return;
    try {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      if (group.creatorUid !== user.uid) {
        alert("Akses Ditolak: Hanya pembuat grup yang dapat menghapus grup ini.");
        return;
      }

      setIsGroupActionLoading(true);

      // 1. Delete all tasks associated with this group
      try {
        const tasksQuery = query(collection(db, 'tasks'), where('groupId', '==', groupId));
        const tasksSnapshot = await getDocs(tasksQuery);
        const taskDeletePromises = tasksSnapshot.docs.map(tDoc => deleteDoc(tDoc.ref));
        await Promise.all(taskDeletePromises);
      } catch (err) {
        console.error("Error deleting group tasks:", err);
      }

      // 2. Delete group document
      try {
        await deleteDoc(doc(db, 'groups', groupId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `groups/${groupId}`);
      }

      // 3. Clean up CURRENT user's member references
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const currentGroups = userSnap.data().groupIds || [];
          await updateDoc(userRef, {
            groupIds: currentGroups.filter((id: string) => id !== groupId)
          });
        }
      } catch (cleanupErr) {
        console.warn("User groupIds cleanup failed:", cleanupErr);
      }

      setViewingGroupId(null);
      setConfirmingGroupAction(null);
    } catch (error) {
      console.error("Error deleting group:", error);
      alert("Gagal menghapus grup.");
    } finally {
      setIsGroupActionLoading(false);
    }
  };

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (timeToMinutes(newTask.endTime) < timeToMinutes(newTask.startTime)) {
      alert("Schedule arrival time cannot be before launch time.");
      return;
    }

    // Guest Mode Persistence
    if (!user) {
      const occurrences = newTask.recurrence === 'none' ? 1 : 12;
      const baseDate = new Date(newTask.date);
      const recurrenceId = newTask.recurrence !== 'none' ? `guest_group_${Date.now()}` : null;
      
      const newTasks: Task[] = [];
      for (let i = 0; i < occurrences; i++) {
        const currentDate = new Date(baseDate);
        if (newTask.recurrence === 'weekly') currentDate.setDate(baseDate.getDate() + (i * 7));
        else if (newTask.recurrence === 'monthly') currentDate.setMonth(baseDate.getMonth() + i);
        
        const dateStr = formatDate(currentDate);
        const guestTask: Task = {
          id: `guest_${Date.now()}_${i}`,
          title: newTask.title,
          description: newTask.description || '',
          date: dateStr,
          startTime: newTask.startTime,
          endTime: newTask.endTime,
          color: newTask.color,
          type: 'mission',
          ownerUid: 'guest',
          status: 'Belum Dikumpul',
          recurrence: newTask.recurrence,
          recurrenceId: recurrenceId,
          createdAt: new Date().toISOString()
        };
        newTasks.push(guestTask);
      }
      setOwnedTasks(prev => [...prev, ...newTasks]);
      closeForm();
      return;
    }

    try {
      if (editingTaskId) {
        const taskData = {
          title: newTask.title,
          description: newTask.description || '',
          date: newTask.date,
          startTime: newTask.startTime,
          endTime: newTask.endTime,
          color: newTask.color,
          updatedAt: serverTimestamp()
        };
        await updateDoc(doc(db, 'tasks', editingTaskId), taskData);
      } else {
        const occurrences = newTask.recurrence === 'none' ? 1 : 12;
        const baseDate = new Date(newTask.date);
        const recurrenceId = newTask.recurrence !== 'none' ? `group_${Date.now()}_${Math.random().toString(36).substring(2, 11)}` : null;
        
        for (let i = 0; i < occurrences; i++) {
          const currentDate = new Date(baseDate);
          if (newTask.recurrence === 'weekly') {
            currentDate.setDate(baseDate.getDate() + (i * 7));
          } else if (newTask.recurrence === 'monthly') {
            currentDate.setMonth(baseDate.getMonth() + i);
          }
          
          const dateStr = formatDate(currentDate);
          const newDocRef = doc(collection(db, 'tasks'));
          const taskData: any = {
            id: newDocRef.id,
            title: newTask.title,
            description: newTask.description || '',
            date: dateStr,
            startTime: newTask.startTime,
            endTime: newTask.endTime,
            color: newTask.color,
            type: 'mission',
            ownerUid: user.uid,
            ownerEmail: user.email,
            creatorName: user.displayName || 'Pilot',
            collaborators: [],
            recurrence: newTask.recurrence,
            createdAt: serverTimestamp()
          };

          if (recurrenceId) {
            taskData.recurrenceId = recurrenceId;
          }
          
          await setDoc(newDocRef, taskData);

          if (newTask.tagEmail.trim()) {
            const shareRef = doc(collection(db, 'sharingRequests'));
            await setDoc(shareRef, {
              id: shareRef.id,
              taskId: newDocRef.id,
              senderUid: user.uid,
              senderName: user.displayName || 'Anonymous',
              recipientEmail: newTask.tagEmail.trim().toLowerCase(),
              status: 'pending',
              taskData: {
                title: newTask.title,
                description: newTask.description || '',
                date: dateStr,
                startTime: newTask.startTime,
                endTime: newTask.endTime,
                color: newTask.color
              },
              createdAt: serverTimestamp()
            });
          }
        }
        
        if (newTask.tagEmail.trim()) {
          alert(`Schedules shared with ${newTask.tagEmail}`);
        }
      }
      closeForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const handleAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      // Guest Mode saving for assignments
      if (editingTaskId) {
        const updatedTasks = tasks.map(t => t.id === editingTaskId ? {
          ...t,
          title: newAssignment.title,
          description: newAssignment.description || '',
          date: newAssignment.date,
          startTime: newAssignment.startTime,
          endTime: newAssignment.endTime,
          color: newAssignment.color,
          category: newAssignment.category,
          taskLink: newAssignment.taskLink,
          submissionLink: newAssignment.submissionLink,
          status: newAssignment.status,
          myNote: newAssignment.myNote,
          updatedAt: new Date().toISOString()
        } : t);
        setOwnedTasks(updatedTasks.filter(t => t.ownerUid === 'guest'));
      } else {
        const guestAssignment: Task = {
          id: `guest_assignment_${Date.now()}`,
          title: newAssignment.title,
          description: newAssignment.description || '',
          date: newAssignment.date,
          startTime: newAssignment.startTime,
          endTime: newAssignment.endTime,
          color: newAssignment.color,
          type: 'assignment',
          category: newAssignment.category,
          taskLink: newAssignment.taskLink,
          submissionLink: newAssignment.submissionLink,
          status: newAssignment.status,
          myNote: newAssignment.myNote,
          ownerUid: 'guest',
          recurrence: 'none',
          createdAt: new Date().toISOString()
        };
        setOwnedTasks(prev => [...prev, guestAssignment]);
      }
      setIsAssignmentFormOpen(false);
      setEditingTaskId(null);
      return;
    }

    try {
      const groupData = newAssignment.groupId ? groups.find(g => g.id === newAssignment.groupId) : null;
      const groupMembers = groupData ? groupData.members : [];
      const updatedCollaborators = Array.from(new Set([...(newAssignment.collaborators || []), ...groupMembers]));

      if (editingTaskId) {
        const taskData = {
          title: newAssignment.title,
          description: newAssignment.description || '',
          date: newAssignment.date,
          startTime: newAssignment.startTime,
          endTime: newAssignment.endTime,
          color: newAssignment.color,
          category: newAssignment.category,
          taskLink: newAssignment.taskLink,
          submissionLink: newAssignment.submissionLink,
          status: newAssignment.status,
          myNote: newAssignment.myNote,
          groupId: newAssignment.groupId,
          collaborators: updatedCollaborators,
          updatedAt: serverTimestamp()
        };
        await updateDoc(doc(db, 'tasks', editingTaskId), taskData);
      } else {
        const newDocRef = doc(collection(db, 'tasks'));
        const taskData = {
          id: newDocRef.id,
          title: newAssignment.title,
          description: newAssignment.description || '',
          date: newAssignment.date,
          startTime: newAssignment.startTime,
          endTime: newAssignment.endTime,
          color: newAssignment.color,
          type: 'assignment',
          category: newAssignment.category,
          taskLink: newAssignment.taskLink,
          submissionLink: newAssignment.submissionLink,
          status: newAssignment.status,
          myNote: newAssignment.myNote,
          groupId: newAssignment.groupId,
          ownerUid: user.uid,
          ownerEmail: user.email,
          creatorName: user.displayName || 'Pilot',
          collaborators: updatedCollaborators,
          recurrence: 'none',
          createdAt: serverTimestamp()
        };
        await setDoc(newDocRef, taskData);
      }
      setIsAssignmentFormOpen(false);
      setEditingTaskId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const openForm = (task?: Task) => {
    if (task) {
      setEditingTaskId(task.id);
      setNewTask({
        title: task.title,
        description: task.description || '',
        date: task.date,
        startTime: task.startTime,
        endTime: task.endTime,
        color: task.color,
        tagEmail: '',
        recurrence: 'none'
      });
    } else {
      const now = new Date();
      const localDate = formatDate(selectedDate);
      
      const startH = now.getHours().toString().padStart(2, '0');
      const startM = now.getMinutes().toString().padStart(2, '0');
      const startTime = `${startH}:${startM}`;
      
      const end = new Date(now.getTime() + 60 * 60 * 1000);
      const endH = end.getHours().toString().padStart(2, '0');
      const endM = end.getMinutes().toString().padStart(2, '0');
      const endTime = `${endH}:${endM}`;
  
      setEditingTaskId(null);
      setNewTask({ 
        title: '', 
        description: '',
        date: localDate,
        startTime, 
        endTime, 
        color: COLORS[0],
        tagEmail: '',
        recurrence: 'none'
      });
    }
    setIsFormOpen(true);
  };

  const openAssignmentForm = (task?: Task, groupId?: string) => {
    if (task) {
      setEditingTaskId(task.id);
      setNewAssignment({
        title: task.title,
        description: task.description || '',
        date: task.date,
        startTime: task.startTime,
        endTime: task.endTime,
        color: task.color,
        category: task.category || 'Individu',
        taskLink: task.taskLink || '',
        submissionLink: task.submissionLink || '',
        status: task.status || 'Belum Dikumpul',
        myNote: task.myNote || '',
        groupId: task.groupId || ''
      });
    } else {
      setEditingTaskId(null);
      setNewAssignment({
        title: '',
        description: '',
        date: formatDate(selectedDate),
        startTime: '00:00',
        endTime: '23:59',
        color: COLORS[1],
        category: groupId ? 'Kelompok' : 'Individu',
        taskLink: '',
        submissionLink: '',
        status: 'Belum Dikumpul',
        myNote: '',
        groupId: groupId || ''
      });
    }
    setIsAssignmentFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingTaskId(null);
  };

  const removeTask = async (taskId: string, deleteAllRecurrence: boolean = false) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      setTaskToDelete(null);
      return;
    }

    // Helper to update all states
    const removeFromState = (id: string, recId?: string) => {
      console.log(`[TaskEngine] Removing task ${id} from local state`);
      const filterFn = (t: Task) => recId ? t.recurrenceId !== recId : t.id !== id;
      
      setOwnedTasks(prev => prev.filter(filterFn));
      setGroupTasksState(prev => prev.filter(filterFn));
      setCollabTasks(prev => prev.filter(filterFn));
      if (selectedTaskId === id) setSelectedTaskId(null);
    };

    if (!user || (task.ownerUid === 'guest')) {
      removeFromState(taskId, deleteAllRecurrence ? task.recurrenceId : undefined);
      setTaskToDelete(null);
      return;
    }

    try {
      const taskGroup = task.groupId ? groups.find(g => g.id === task.groupId) : null;
      const isOwner = task.ownerUid === user.uid;
      const isAdminOfGroup = taskGroup && (taskGroup.creatorUid === user.uid || taskGroup.admins?.includes(user.uid));

      if (!isOwner && !isAdminOfGroup) {
        console.warn(`[TaskEngine] Permission denied for user ${user.uid} to delete task ${taskId}`);
        alert("Akses Ditolak: Anda tidak memiliki izin untuk menghapus misi ini.");
        setTaskToDelete(null);
        return;
      }

      console.log(`[TaskEngine] Synchronizing deletion of task ${taskId} with Core Network...`);
      removeFromState(taskId, deleteAllRecurrence ? task.recurrenceId : undefined);

      if (deleteAllRecurrence && task.recurrenceId) {
        const related = tasks.filter(t => t.recurrenceId === task.recurrenceId);
        await Promise.all(related.map(t => deleteDoc(doc(db, 'tasks', t.id))));
      } else {
        await deleteDoc(doc(db, 'tasks', taskId));
      }
      setTaskToDelete(null);
    } catch (error: any) {
      console.error('Delete error:', error);
      if (error.code === 'permission-denied') {
        alert("Izin ditolak oleh server.");
      } else {
        handleFirestoreError(error, OperationType.DELETE, 'tasks');
      }
      setTaskToDelete(null);
    }
  };

  const removeScheduleItem = async (groupId: string, item: GroupScheduleItem, index?: number | null) => {
    try {
      const group = groups.find(g => g.id === groupId);
      if (!group || !group.schedule) return;

      const isAuthorized = !user || group.creatorUid === user?.uid || group.admins?.includes(user?.uid || '');
      if (!isAuthorized) {
        alert("Akses Ditolak: Anda tidak memiliki izin untuk mengubah jadwal kelompok ini.");
        return;
      }

      const fullSchedule = [...group.schedule];
      let targetIdx = -1;
      const targetSubject = item.subject || (item as any).title || '';

      // 1. Try to find by ID (Highly reliable)
      if (item.id && !item.id.startsWith('schedule-')) {
        targetIdx = fullSchedule.findIndex(i => i.id === item.id);
      }

      // 2. Try to find by index if ID search failed or ID was missing
      if (targetIdx === -1 && index !== undefined && index !== null && index >= 0 && index < fullSchedule.length) {
        const itemAtIndex = fullSchedule[index];
        // Only trust index if the subject matches or it has no ID or the subject matches either subject or title
        if (itemAtIndex && (itemAtIndex.subject === targetSubject || itemAtIndex.title === targetSubject || !itemAtIndex.id)) {
          targetIdx = index;
        }
      }

      // 3. Fallback: Search by fields (last resort)
      if (targetIdx === -1) {
        targetIdx = fullSchedule.findIndex(i => 
          (i.subject === targetSubject || i.title === targetSubject) && i.day === item.day && i.startTime === item.startTime
        );
      }

      // 4. Fallback 2: Search by subject title only
      if (targetIdx === -1 && targetSubject) {
        targetIdx = fullSchedule.findIndex(i => 
          i.subject === targetSubject || i.title === targetSubject
        );
      }

      if (targetIdx !== -1) {
        fullSchedule.splice(targetIdx, 1);
        await updateDoc(doc(db, 'groups', groupId), { 
          schedule: fullSchedule,
          updatedAt: serverTimestamp()
        });
        
        // Optimistically close modal
        setIsScheduleModalOpen(false);
      } else {
        // Fallback for UI: just close if we can't find it but it was supposed to be there
        setIsScheduleModalOpen(false);
        console.warn("Could not find item to remove, closing modal anyway.");
      }
    } catch (err: any) {
      console.error("Delete failed:", err);
      handleFirestoreError(err, OperationType.UPDATE, `groups/${groupId}`);
    }
  };

  const clearAllSchedule = async (groupId: string) => {
    if (!window.confirm("Hapus seluruh jadwal di grup ini? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      await updateDoc(doc(db, 'groups', groupId), { 
        schedule: [],
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error("Clear schedule failed:", err);
      alert("Gagal menghapus jadwal.");
    }
  };

  const openScheduleEditor = (item?: GroupScheduleItem, idx?: number) => {
    if (item) {
      setEditingScheduleItem({...item});
      setEditingScheduleIdx(idx !== undefined ? idx : null);
    } else {
      setEditingScheduleItem({
        id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        day: 'SENIN',
        subject: '',
        modality: 'Offline',
        startTime: '08:00',
        endTime: '10:00',
        lecturers: [],
        hasAssignment: false,
        sks: 2,
        duration: '2h 0m'
      });
      setEditingScheduleIdx(null);
    }
    setIsScheduleModalOpen(true);
  };

  // Standard 12-hour clock numbers
  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  // Clock Hand Rotation Calculations: We use a base timestamp from when the component mounted to calculate delta
  // this ensures the hands only ever rotate forward and never jump back at 12:00.
  const baseTimeRef = React.useRef(new Date());
  const initialAngles = React.useMemo(() => {
    const s = baseTimeRef.current.getSeconds();
    const m = baseTimeRef.current.getMinutes();
    const h = baseTimeRef.current.getHours();
    return {
      sec: s * 6,
      min: m * 6 + s * 0.1,
      hr: (h % 12) * 30 + m * 0.5
    };
  }, []);

  const deltaSeconds = (currentTime.getTime() - baseTimeRef.current.getTime()) / 1000;
  
  const secAngle = initialAngles.sec + deltaSeconds * 6;
  const minAngle = initialAngles.min + deltaSeconds * 0.1;
  const hrAngle = initialAngles.hr + deltaSeconds * (0.5 / 60);

  const [viewDate, setViewDate] = useState(new Date());

  const getDaysInMonth = (year: number, month: number) => {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) {
      days.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }
    return days;
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const calendarDays = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());
  const firstDayOfMonth = calendarDays[0].getDay();

  const [viewWeekDate, setViewWeekDate] = useState(new Date());
  const [weekDirection, setWeekDirection] = useState(0);

  // Sync view week when selected date changes, but only if it's outside current range
  useEffect(() => {
    setViewWeekDate(prevView => {
      const startOfViewWeek = new Date(prevView);
      startOfViewWeek.setDate(prevView.getDate() - prevView.getDay());
      startOfViewWeek.setHours(0, 0, 0, 0);

      const endOfViewWeek = new Date(startOfViewWeek);
      endOfViewWeek.setDate(startOfViewWeek.getDate() + 6);
      endOfViewWeek.setHours(23, 59, 59, 999);

      if (selectedDate < startOfViewWeek || selectedDate > endOfViewWeek) {
        setWeekDirection(selectedDate < startOfViewWeek ? -1 : 1);
        return new Date(selectedDate);
      }
      return prevView;
    });
  }, [selectedDate]);

  const weekDays = React.useMemo(() => {
    const startOfWeek = new Date(viewWeekDate);
    startOfWeek.setDate(viewWeekDate.getDate() - viewWeekDate.getDay());
    
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      return day;
    });
  }, [viewWeekDate]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const changeWeek = (offset: number) => {
    setWeekDirection(offset);
    const nextWeek = new Date(viewWeekDate);
    nextWeek.setDate(viewWeekDate.getDate() + (offset * 7));
    setViewWeekDate(nextWeek);
  };

  return (
    <div className="min-h-screen transition-colors duration-1000 font-sans bg-[#8da876] text-zinc-900 pb-40">
      
      {/* Header */}
      <header className="p-6 flex justify-between items-center max-w-7xl mx-auto px-6 sm:px-8 w-full relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-matcha-400 via-matcha-500 to-matcha-600 flex items-center justify-center text-white shadow-lg shadow-matcha-600/20">
            <Clock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-display font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-matcha-900 to-matcha-600">Me Times</h1>
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="relative">
              <button 
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-3 p-1 pr-3 rounded-full bg-white/75 backdrop-blur-md shadow-sm border border-white/40 hover:border-white/85 hover:bg-white/85 transition-all active:scale-95 relative"
              >
                <div className="relative">
                  <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full shadow-sm" />
                </div>
                <div className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-[10px] font-display font-black uppercase tracking-widest text-matcha-700 opacity-80">Account</span>
                  <span className="text-xs font-bold truncate max-w-[80px]">{user.displayName?.split(' ')[0]}</span>
                </div>
              </button>

              <AnimatePresence>
                {isUserMenuOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsUserMenuOpen(false)} 
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className={`absolute right-0 mt-2 w-56 rounded-2xl shadow-2xl border overflow-hidden z-50 py-2 transition-all duration-300 ${isNight ? 'glass-dark text-white' : 'glass-light text-zinc-900 border-white/50'}`}
                    >
                      <div className="px-4 py-3 border-b border-white/30 mb-1">
                        <p className="text-xs font-display font-black uppercase tracking-widest text-matcha-700 opacity-80 mb-1">Signed in as</p>
                        <p className="text-sm font-bold truncate">{user.email}</p>
                      </div>

                      <button 
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setShowAllTasks(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-zinc-50 text-zinc-500 group-hover:bg-black group-hover:text-white transition-colors">
                          <CalendarIcon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold">All Schedules</span>
                      </button>

                      <button 
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          logOut();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-rose-50 text-rose-500 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-rose-50 text-rose-500 group-hover:bg-rose-500 group-hover:text-white transition-colors">
                          <LogOut className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold">Logout</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button 
              onClick={() => signInWithGoogle()}
              className="flex items-center gap-3 p-1 pr-3 rounded-full bg-white/75 backdrop-blur-md shadow-sm border border-white/40 hover:border-white/85 hover:bg-white/85 transition-all active:scale-95 group"
            >
              <div className="w-8 h-8 rounded-full bg-white/75 backdrop-blur-sm border border-white/50 flex items-center justify-center text-zinc-400 group-hover:text-zinc-500 transition-colors">
                <UserIcon className="w-5 h-5" />
              </div>
              <div className="hidden sm:flex flex-col items-start leading-none">
                <span className="text-[10px] font-display font-black uppercase tracking-widest text-matcha-700 opacity-80">Guest</span>
                <span className="text-xs font-extrabold text-zinc-800">Sign In</span>
              </div>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full relative pb-32 md:pb-40">
        {currentTab === 'dashboard' ? (
          <div className="max-w-7xl mx-auto px-6 sm:px-8 w-full flex flex-col lg:flex-row gap-12 lg:gap-16 items-start pt-4">
        
        {/* Analog Clock Section */}
        <section className="w-full lg:w-[48%] lg:sticky lg:top-8 flex flex-col items-center justify-center relative">
          <div className="mb-8 text-center">
            <motion.h2 
              key={selectedDate.toDateString()}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl font-display font-extrabold tracking-tight uppercase text-matcha-900"
            >
              {selectedDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </motion.h2>
          </div>
          <div className="relative w-[300px] h-[300px] sm:w-[420px] sm:h-[420px] xl:w-[480px] xl:h-[480px] perspective-1000">
            <AnimatePresence mode="wait">
              <motion.div
                key={isClockNight ? 'night' : 'day'}
                initial={{ rotateY: 90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: -90, opacity: 0 }}
                transition={{ duration: 0.6, ease: "circOut" }}
                className="relative w-full h-full clock-face-container pointer-events-auto"
              >
                {/* Main Clock Face */}
                <div className={`absolute inset-0 rounded-full border-[12px] sm:border-[16px] transition-all duration-500 ${
                  isClockNight 
                    ? 'bg-zinc-950/25 border-white/10 shadow-3d-dark backdrop-blur-3xl' 
                    : 'bg-white border-white/55 shadow-3d-light'
                }`}>
                  {/* Subtle inner ring */}
                  <div className={`absolute inset-4 rounded-full border border-dashed opacity-10 ${isClockNight ? 'border-white' : 'border-black'}`} />
                </div>

                {/* Task Wedges SVG */}
                <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                  {(() => {
                    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                    const currentDayIndo = daysIndo[selectedDate.getDay()];
                    
                    const dayTasks = tasks
                      .filter(t => t.type === 'mission' && t.date === formatDate(selectedDate) && !hiddenTaskIds.has(t.id))
                      .map(t => isTimeNight(t.startTime) ? { ...t, color: '#000000' } : t);
                    
                    const daySchedules = groups.flatMap(group => 
                      (group.schedule || [])
                        .filter(item => item.day?.toUpperCase() === currentDayIndo.toUpperCase())
                        .map(item => ({
                          ...item,
                          id: item.id || `schedule-${group.id}-${item.subject}-${item.startTime}`,
                          title: item.subject,
                          color: isTimeNight(item.startTime) ? '#000000' : '#678850', // Fixed matcha for schedule items, black if night
                          isSchedule: true
                        }))
                        .filter(item => !hiddenTaskIds.has(item.id))
                    );

                    return [...dayTasks, ...daySchedules].map(task => {
                    const startMins = timeToMinutes(task.startTime);
                    const endMins = timeToMinutes(task.endTime);

                    // A task can span 24 hours, but we only show the 12h window for the current "Shift"
                    // Day Shift: 06:00 to 18:00 (360 to 1080)
                    // Night Shift: 18:00 to 06:00 (1080 to 360 next day)
                    const shiftStart = isClockNight ? 18 * 60 : 6 * 60;
                    const shiftEnd = shiftStart + 12 * 60;

                    let tStart = startMins;
                    let tEnd = endMins;
                    
                    // Handle range crossing midnight
                    if (tEnd < tStart) tEnd += 24 * 60;

                    // Normalize to find intersection with the 12h shift
                    // We might need to check multiple 24h spans if tasks are long, 
                    // but usually, they are simple.
                    const checkRange = (s: number, e: number) => {
                      const intersectionStart = Math.max(shiftStart, s);
                      const intersectionEnd = Math.min(shiftEnd, e);
                      if (intersectionStart < intersectionEnd) {
                        return { start: intersectionStart, end: intersectionEnd };
                      }
                      return null;
                    };

                    // Check current span and wrap-around spans
                    const range = checkRange(tStart, tEnd) || 
                                  checkRange(tStart - 24 * 60, tEnd - 24 * 60) || 
                                  checkRange(tStart + 24 * 60, tEnd + 24 * 60);

                    if (!range) return null;

                    const startAngle = getAngle(range.start);
                    let endAngle = getAngle(range.end);
                    if (endAngle < startAngle) endAngle += 360;

                    const angleWidth = endAngle - startAngle;
                    const midAngle = (startAngle + endAngle) / 2;
                    const midRad = (midAngle - 90) * Math.PI / 180;
                    
                    // Position label at 70% of the radius for better visibility
                    const labelRadius = 30; 
                    const labelX = 50 + labelRadius * Math.cos(midRad);
                    const labelY = 50 + labelRadius * Math.sin(midRad);

                    // Dynamic font size: min 1px, max 4px based on wedge width
                    const fontSize = Math.max(1, Math.min(4, angleWidth / 8));
                    
                    // Calculate rotation: 
                    // We want the text to follow the ray from center.
                    // If the angle is on the left side (90-270), we flip it 180 so it's not upside down.
                    let rotation = midAngle;
                    if (midAngle > 90 && midAngle < 270) {
                      rotation += 180;
                    }

                    return (
                      <g 
                        key={task.id}
                        className="group"
                      >
                        <motion.path
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 0.7, scale: 1 }}
                          d={describeArc(50, 50, 42, startAngle, endAngle)}
                          fill={task.color}
                          className="cursor-pointer hover:opacity-100 transition-opacity"
                          whileHover={{ opacity: 0.9 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTaskId(task.id);
                          }}
                        />
                        {angleWidth > 5 && ( // Only show text if wedge is wide enough
                          <motion.text
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            x={labelX}
                            y={labelY}
                            fill="white"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="font-black pointer-events-none uppercase tracking-tighter"
                            style={{ 
                              fontSize: `${fontSize}px`, 
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              transform: `rotate(${rotation}deg)`,
                              transformOrigin: `${labelX}% ${labelY}%`
                            }}
                          >
                            {task.title.length > Math.floor(angleWidth / 3) 
                              ? task.title.substring(0, Math.max(1, Math.floor(angleWidth / 4))) + '..' 
                              : task.title
                            }
                          </motion.text>
                        )}
                      </g>
                    );
                  });
                })()}
                </svg>

                {/* Hour Labels */}
                {hours.map((hour, i) => {
                  const angle = i * 30; // 360 / 12 = 30 degrees per hour
                  const rad = (angle - 90) * (Math.PI / 180);
                  const x = 50 + 38 * Math.cos(rad);
                  const y = 50 + 38 * Math.sin(rad);
                  return (
                    <div 
                      key={`${isClockNight}-${hour}-${i}`}
                      className="absolute w-10 h-10 flex items-center justify-center"
                      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                    >
                      <div className="flex flex-col items-center">
                        <span className={`text-sm font-black font-mono transition-colors ${
                          isClockNight ? 'text-white/80' : 'text-[#2d3a22]'
                        }`}>
                          {hour.toString().padStart(2, '0')}
                        </span>
                        <div className={`w-1 h-1 rounded-full mt-1 ${isClockNight ? 'bg-zinc-800' : 'bg-white/70'}`} />
                      </div>
                    </div>
                  );
                })}

                {/* Original Center Dot */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-4 z-30 ${
                  isClockNight ? 'bg-matcha-400 border-zinc-900' : 'bg-matcha-600 border-white'
                }`} />

                {/* Clock Hands */}
                <div className="absolute inset-0 pointer-events-none z-20">
                  {/* Hour Hand */}
                  <motion.div 
                    className={`absolute top-1/2 left-1/2 w-1.5 h-16 sm:h-24 -ml-[3px] -mt-16 sm:-mt-24 origin-bottom rounded-full ${
                      isClockNight ? 'bg-white' : 'bg-matcha-900'
                    }`}
                    animate={{ rotate: hrAngle }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                  {/* Minute Hand */}
                  <motion.div 
                    className={`absolute top-1/2 left-1/2 w-1 h-24 sm:h-36 -ml-0.5 -mt-24 sm:-mt-36 origin-bottom rounded-full ${
                      isClockNight ? 'bg-matcha-400' : 'bg-[#8da876] shadow-sm'
                    }`}
                    animate={{ rotate: minAngle }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                  {/* Second Hand */}
                  <motion.div 
                    className="absolute top-1/2 left-1/2 w-0.5 h-28 sm:h-40 -ml-[1px] -mt-28 sm:-mt-40 origin-bottom bg-rose-500 rounded-full"
                    animate={{ rotate: secAngle }}
                    transition={{ ease: "linear", duration: 0.1 }}
                  />
                  {/* Small Second Hand Counterbalance */}
                  <motion.div 
                    className="absolute top-1/2 left-1/2 w-0.5 h-6 sm:h-8 -ml-[1px] origin-top bg-rose-500 opacity-50" 
                    animate={{ rotate: secAngle }}
                    transition={{ ease: "linear", duration: 0.1 }}
                    style={{ transformOrigin: "top center" }}
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Theme Toggle Below Clock */}
          <div className="flex justify-center mt-12 mb-8 relative z-30">
            <motion.button 
              onClick={() => setIsClockNight(!isClockNight)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`group flex items-center gap-3 px-8 py-3 rounded-full border shadow-2xl transition-all duration-700 ${
                isClockNight 
                  ? 'bg-zinc-900 border-zinc-800/80 text-matcha-400 shadow-matcha-900/40' 
                  : 'bg-white border-zinc-150 text-matcha-600 shadow-matcha-600/10'
              }`}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={isClockNight ? 'moon' : 'sun'}
                  initial={{ opacity: 0, rotate: -30, scale: 0.5 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 30, scale: 0.5 }}
                  transition={{ duration: 0.2 }}
                >
                  {isClockNight ? <Moon className="w-5 h-5 fill-current" /> : <Sun className="w-5 h-5 fill-current" />}
                </motion.div>
              </AnimatePresence>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-sans font-extrabold uppercase tracking-[0.2em] opacity-50">Switch Shift</span>
                <span className="text-xs font-display font-bold uppercase tracking-widest mt-0.5">{isClockNight ? 'Night Mode' : 'Day Mode'}</span>
              </div>
            </motion.button>
          </div>

          <div className={`mt-12 text-left w-full p-4 sm:p-8 rounded-3xl transition-all duration-500 shadow-3d-float border ${
            isNight 
              ? 'bg-zinc-950/20 border-white/10 shadow-3d-dark backdrop-blur-3xl text-white' 
              : 'bg-[#8da876] border-white/35 shadow-3d-light text-white'
          }`}>
            {/* Weekly Calendar Section */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                <div className="flex flex-col items-start">
                  <h3 className={`text-xs font-display font-extrabold uppercase tracking-widest ${isNight ? 'text-[#2d3a22]' : 'text-white'}`}>Weekly Log</h3>
                  <p className={`text-[10px] font-mono font-bold uppercase tracking-wider mt-1 ${isNight ? 'text-[#3a4b2e] opacity-75' : 'text-white/85'}`}>
                    {weekDays[0].toLocaleDateString('id-ID', { month: 'short' })} {weekDays[0].getDate()} - {weekDays[6].toLocaleDateString('id-ID', { month: 'short' })} {weekDays[6].getDate()}
                  </p>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                  <div className={`flex items-center rounded-xl p-1 shadow-sm border ${
                    isNight 
                      ? 'bg-zinc-800/85 border-zinc-700/60 text-zinc-300' 
                      : 'bg-white/90 border-transparent text-zinc-800'
                  }`}>
                    <button 
                      onClick={() => changeWeek(-1)}
                      className="p-1.5 rounded-lg transition-colors hover:bg-white/40 text-zinc-800 hover:text-zinc-950"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => changeWeek(1)}
                      className="p-1.5 rounded-lg transition-colors hover:bg-white/40 text-zinc-800 hover:text-zinc-950"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowFullCalendar(true)}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors flex items-center gap-2 text-[10px] font-display font-bold tracking-widest text-white hover:text-white/80 font-black"
                  >
                    <CalendarIcon className="w-4 h-4" />
                    VIEW FULL
                  </button>
                </div>
              </div>
              <div className="w-full">
                <AnimatePresence mode="popLayout" custom={weekDirection}>
                  <motion.div 
                    key={viewWeekDate.toDateString()}
                    custom={weekDirection}
                    initial={{ x: weekDirection > 0 ? 100 : -100, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: weekDirection > 0 ? -100 : 100, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="grid grid-cols-7 gap-1 sm:gap-2.5 w-full pb-2"
                  >
                    {weekDays.map((date, i) => {
                    const isSelected = date.toDateString() === selectedDate.toDateString();
                    const isToday = date.toDateString() === new Date().toDateString();
                    const isHolidayDay = isHoliday(date);
                    const dateKey = date.toLocaleDateString('en-CA');
                    
                    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                    const dateDayIndo = daysIndo[date.getDay()];
                    
                    const dayTasks = tasks
                      .filter(t => t.date === dateKey && !hiddenTaskIds.has(t.id))
                      .map(t => isTimeNight(t.startTime) ? { ...t, color: '#000000' } : t);
                    const daySchedules = groups.flatMap(group => 
                      (group.schedule || [])
                        .filter(item => {
                          const schedId = item.id || `schedule-${group.id}-${item.subject}-${item.startTime}`;
                          return item.day?.toUpperCase() === dateDayIndo.toUpperCase() && !hiddenTaskIds.has(schedId);
                        })
                    );
                    
                    const combinedItems = [
                      ...dayTasks,
                      ...daySchedules.map(s => ({ ...s, color: isTimeNight(s.startTime) ? '#000000' : '#678850' }))
                    ];
                    
                    // Calculate total duration to scale the indicator bars
                    const totalMinutes = combinedItems.reduce((acc, t) => {
                      let tStart = timeToMinutes(t.startTime);
                      let tEnd = timeToMinutes(t.endTime);
                      if (tEnd < tStart) tEnd += 24 * 60;
                      return acc + (tEnd - tStart);
                    }, 0);

                    return (
                      <button 
                        key={i} 
                        onClick={() => setSelectedDate(date)}
                        className={`flex flex-col items-center p-1 sm:p-3 rounded-xl sm:rounded-2xl min-w-0 w-full transition-all transform active:scale-95 relative overflow-hidden backdrop-blur-md ${
                          isSelected 
                            ? 'bg-matcha-900 text-white scale-105 shadow-md shadow-matcha-950/25 border border-matcha-700/50'
                            : 'bg-white/72 text-matcha-900 hover:bg-white/85 shadow-sm border border-white/50'
                        }`}
                      >
                        <span className={`text-[8px] sm:text-[10px] font-display font-extrabold uppercase tracking-wide sm:tracking-widest mb-1 sm:mb-1.5 ${!isSelected && isHolidayDay ? 'text-rose-600' : ''}`}>{dayNames[i]}</span>
                        <span className={`text-sm sm:text-lg font-mono font-bold tracking-tight ${isSelected ? 'text-white' : isHolidayDay ? 'text-rose-600' : 'text-matcha-900'}`}>{date.getDate()}</span>
                        {isToday && <div className={`w-1 h-1 rounded-full mt-0.5 sm:mt-1 ${isSelected ? 'bg-white' : 'bg-matcha-900'}`} />}
                        
                        {/* Activity Indicator Bars */}
                        {combinedItems.length > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 flex gap-px bg-black/5">
                            {combinedItems.map((t, idx) => {
                              let tStart = timeToMinutes(t.startTime);
                              let tEnd = timeToMinutes(t.endTime);
                              if (tEnd < tStart) tEnd += 24 * 60;
                              const duration = tEnd - tStart;
                              const widthPercent = (duration / (totalMinutes || 1)) * 100;
                              return (
                                <div 
                                  key={(t as any).id || idx} 
                                  className="h-full" 
                                  style={{ 
                                    width: `${widthPercent}%`, 
                                    backgroundColor: t.color,
                                    opacity: isSelected ? 1 : 0.6 
                                  }} 
                                />
                              );
                            })}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

        {/* Sidebar */}
        <aside className="w-full lg:w-[52%] flex flex-col gap-8 pb-12 lg:pb-32">
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => openForm()}
              className={`w-full py-5 rounded-2xl font-display font-black text-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.96] shadow-xl hover:-translate-y-0.5 border ${
                isNight 
                  ? 'bg-gradient-to-r from-matcha-500 to-matcha-700 hover:from-matcha-400 hover:to-matcha-600 text-white border-matcha-500/20 shadow-matcha-900/45 hover:shadow-matcha-500/30' 
                  : 'bg-gradient-to-r from-matcha-600 to-matcha-800 hover:from-matcha-700 hover:to-matcha-900 text-white border-matcha-700 shadow-matcha-800/15 hover:shadow-matcha-850/30'
              }`}
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
              ADD SCHEDULE
            </button>
          </div>

          <div className="flex-1 space-y-4 pr-2 custom-scrollbar">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-display font-extrabold uppercase tracking-widest text-[#2d3a22]">Schedule List</h3>
              <button 
                onClick={() => setShowChronologicalView(!showChronologicalView)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white hover:bg-zinc-50 text-[10px] font-display font-bold uppercase tracking-widest text-zinc-805 hover:text-zinc-950 transition-all border border-zinc-200/50 shadow-sm"
              >
                {showChronologicalView ? (
                  <><EyeOff className="w-3.5 h-3.5" /> Hide Log</>
                ) : (
                  <><Eye className="w-3.5 h-3.5" /> Show Log</>
                )}
              </button>
            </div>
            
            <AnimatePresence mode="wait">
              {showChronologicalView && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4 overflow-hidden rounded-2xl"
                >
                  {(() => {
                    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                    const currentDayIndo = daysIndo[selectedDate.getDay()];
                    
                    const dayMissions = tasks
                      .filter(t => t.type === 'mission' && t.date === formatDate(selectedDate))
                      .map(t => isTimeNight(t.startTime) ? { ...t, color: '#000000' } : t);
                    
                    const daySchedules = groups.flatMap(group => 
                      (group.schedule || [])
                        .filter(item => item.day?.toUpperCase() === currentDayIndo.toUpperCase())
                        .map(item => ({
                          ...item,
                          id: item.id || `schedule-${group.id}-${item.subject}-${item.startTime}`,
                          isSchedule: true,
                          groupName: group.name,
                          title: item.subject,
                          color: isTimeNight(item.startTime) ? '#000000' : '#678850', // Fixed matcha for schedule items, black if night
                          type: 'mission' as const // For styling purposes
                        }))
                    );

                    const chronologicalItems = [
                      ...dayMissions.map(m => ({ ...m, isTask: true })),
                      ...daySchedules
                    ].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

                    if (chronologicalItems.length === 0) {
                      return (
                        <div className="p-12 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 text-center border-white/40 text-[#2c3922] bg-white/55">
                          <p className="text-sm font-black uppercase tracking-wider">No schedule for this date.</p>
                        </div>
                      );
                    }

                    return chronologicalItems.map(item => {
                      const isSchedule = 'isSchedule' in item;
                      const isHidden = hiddenTaskIds.has(item.id);
                      const isNightItem = isTimeNight(item.startTime);
                      
                      return (
                        <motion.div 
                          layout
                          key={item.id} 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: isHidden ? 0.4 : 1, x: 0 }}
                          className={`p-5 rounded-2xl border shadow-3d-float transition-all group relative overflow-hidden cursor-pointer backdrop-blur-md ${
                            isHidden 
                              ? 'grayscale opacity-60 bg-zinc-100/50 border-zinc-200' 
                              : isNightItem
                                ? 'border-zinc-800/80 shadow-3d-dark hover:border-zinc-700/60'
                                : isNight 
                                  ? 'border-zinc-800/80 hover:border-zinc-700/60 shadow-3d-dark' 
                                  : 'border-zinc-100/50 hover:border-zinc-200 shadow-sm'
                          }`}
                          style={{ 
                            background: isHidden ? undefined : (isNightItem ? '#000000' : (isSchedule ? (isNight ? 'rgba(24, 24, 27, 0.35)' : 'rgba(255, 255, 255, 0.22)') : getTaskBackground(item as any))),
                            color: isHidden ? '#71717a' : (isNightItem ? '#ffffff' : (isSchedule ? (isNight ? '#cbd5e1' : '#18181b') : getTaskTextColor(item as any, isNight))),
                            borderColor: isHidden ? '#e4e4e7' : (isNightItem ? 'rgba(255, 255, 255, 0.15)' : (isSchedule ? (isNight ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)') : (getTaskTextColor(item as any, isNight) === '#ffffff' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')))
                          }}
                          onClick={() => {
                            setSelectedTaskId(item.id);
                          }}
                        >
                          <div className="absolute top-0 left-0 bottom-0 w-1.5" style={{ backgroundColor: item.color, opacity: isHidden ? 0.3 : 1 }} />
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 pr-4">
                              <div className="flex items-center gap-2 mb-1.5">
                                <p className={`font-display font-extrabold text-base truncate uppercase tracking-tight ${isHidden ? 'line-through opacity-50' : ''}`}>{item.title}</p>
                                {isSchedule ? (
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-display font-black uppercase tracking-widest whitespace-nowrap ${isNightItem ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                                    Jadwal {item.modality}
                                  </span>
                                ) : (item as any).ownerUid !== user?.uid && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 text-[8px] font-display font-black uppercase tracking-widest whitespace-nowrap">
                                    Co-Pilot
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                <p className="text-[10px] font-mono font-bold opacity-60 flex items-center gap-1.5">
                                  <Clock className="w-3 h-3" /> {item.startTime} — {item.endTime}
                                </p>
                                {isSchedule ? (
                                  <p className="text-[10px] font-sans font-extrabold uppercase tracking-wider opacity-40 italic">
                                    From <span>{item.groupName}</span>
                                  </p>
                                ) : (item as any).ownerUid !== user?.uid && (
                                  <p className="text-[10px] font-sans font-extrabold uppercase tracking-wider opacity-40 italic">
                                    By <span>{getPilotDisplay(item as any)}</span>
                                  </p>
                                )}
                                {!isSchedule && (item as any).recurrence && (item as any).recurrence !== 'none' && (
                                  <div className="flex items-center gap-1 text-[8px] font-display font-black uppercase tracking-widest text-[#71717a] opacity-60">
                                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                                    {(item as any).recurrence} Loop
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTaskVisibility(item.id);
                                }}
                                className={`p-2.5 rounded-xl transition-all border ${
                                  isHidden 
                                    ? 'bg-amber-100 border-amber-200 text-amber-700' 
                                    : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600 border-zinc-200/60'
                                } opacity-90 hover:opacity-100 hover:scale-105 active:scale-95`}
                              >
                                {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                              </button>
                              {!isSchedule && canEditTask(item as any) && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if ((item as any).recurrenceId) {
                                      setTaskToDelete(item as any);
                                    } else if (window.confirm(`Hapus "${item.title}"?`)) {
                                      removeTask(item.id);
                                    }
                                  }}
                                  className="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl transition-all hover:bg-rose-500 hover:text-white hover:scale-105 active:scale-95"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    });
                  })()}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Assignments Due Today Section */}
            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-xs font-display font-extrabold uppercase tracking-widest ${isNight ? 'text-[#2d3a22]' : 'text-white'}`}>Assignments Due Today</h3>
                <div className="px-3 py-1 rounded-full bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest">
                  {tasks.filter(t => t.type === 'assignment' && t.date === formatDate(selectedDate)).length} List
                </div>
              </div>

              <div className="space-y-3">
                {tasks.filter(t => t.type === 'assignment' && t.date === formatDate(selectedDate)).length === 0 ? (
                  <div className="p-8 rounded-[32px] border-2 border-dashed border-white/40 flex flex-col items-center justify-center gap-2 text-center bg-white/15">
                    <p className={`text-[10px] font-black uppercase tracking-widest italic ${isNight ? 'text-[#4c5f3e]' : 'text-white/85'}`}>No assignments due today</p>
                  </div>
                ) : (
                  tasks
                    .filter(t => t.type === 'assignment' && t.date === formatDate(selectedDate))
                    .map(assignment => (
                      <motion.div
                        key={assignment.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-4 rounded-[28px] bg-white/70 border border-white/20 hover:border-matcha-600/30 backdrop-blur-sm hover:bg-white/80 transition-all group flex items-center gap-4 cursor-pointer shadow-sm"
                        onClick={() => setSelectedTaskId(assignment.id)}
                      >
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: assignment.color + '20' }}>
                          <LayoutGrid className="w-5 h-5" style={{ color: assignment.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black uppercase tracking-tight truncate">{assignment.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                              assignment.status === 'Sudah Dikumpul' ? 'bg-emerald-100 text-emerald-700' : 
                              assignment.status === 'Dalam Proses' ? 'bg-amber-100 text-amber-700' : 
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {assignment.status}
                            </span>
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight className="w-4 h-4 text-zinc-400" />
                        </div>
                      </motion.div>
                    ))
                )}
              </div>
            </div>

          </div>
        </aside>
          </div>
        ) : currentTab === 'recap' ? (
          <div className="flex-1 flex flex-col p-4 sm:p-8 no-scrollbar bg-transparent">
            <header className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6 px-4">
              <div />
              <button 
                onClick={() => openAssignmentForm()}
                className="group flex items-center gap-3 px-8 py-5 bg-matcha-600 text-white rounded-[24px] font-black text-[10px] uppercase tracking-[0.2em] hover:bg-matcha-700 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-matcha-650/20"
              >
                <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                Initialize Assignment
              </button>
            </header>            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 px-4 mb-8">
              {(() => {
                const assignments = tasks.filter(t => t.type === 'assignment' && t.status !== 'Sudah Dikumpul');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const urgentTasks = assignments.filter(t => {
                  const d = new Date(t.date);
                  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  return diff <= 1;
                });
                
                const warningTasks = assignments.filter(t => {
                  const d = new Date(t.date);
                  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  return diff > 1 && diff <= 3;
                });

                return (
                  <>
                    <div className="p-3 sm:p-6 rounded-[16px] sm:rounded-[32px] bg-rose-50/70 border border-rose-100/60 flex items-center gap-3 sm:gap-4 shadow-sm flex-1 backdrop-blur-md">
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-rose-500 flex items-center justify-center text-white font-black text-sm sm:text-xl italic animate-pulse flex-shrink-0 font-sans">
                        {urgentTasks.length}
                      </div>
                      <div>
                        <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-rose-500 leading-tight">Urgent Status</p>
                        <p className="text-[7px] sm:text-[8px] font-bold text-rose-400 uppercase tracking-tight">Today / Tomorrow</p>
                      </div>
                    </div>
                    <div className="p-3 sm:p-6 rounded-[16px] sm:rounded-[32px] bg-amber-50/70 border border-amber-100/60 flex items-center gap-3 sm:gap-4 shadow-sm flex-1 backdrop-blur-md">
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-amber-500 flex items-center justify-center text-white font-black text-sm sm:text-xl italic flex-shrink-0 font-sans">
                        {warningTasks.length}
                      </div>
                      <div>
                        <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-amber-500 leading-tight">Warning Status</p>
                        <p className="text-[7px] sm:text-[8px] font-bold text-amber-400 uppercase tracking-tight">Deadline 2-3 Days</p>
                      </div>
                    </div>
                    <div className="p-3 sm:p-6 rounded-[16px] sm:rounded-[32px] bg-emerald-50/70 border border-emerald-100/65 flex items-center gap-3 sm:gap-4 shadow-sm flex-1 backdrop-blur-md">
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-emerald-500 flex items-center justify-center text-white font-black text-sm sm:text-xl italic flex-shrink-0 font-sans">
                        {tasks.filter(t => t.type === 'assignment' && t.status === 'Sudah Dikumpul').length}
                      </div>
                      <div>
                        <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-emerald-500 leading-tight">Schedule Accomplished</p>
                        <p className="text-[7px] sm:text-[8px] font-bold text-emerald-400 uppercase tracking-tight">Successfully Submitted</p>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            
            <div className="w-full overflow-x-auto no-scrollbar pb-6">
              <div className="min-w-[1600px] border border-white/20 rounded-[40px] overflow-hidden bg-white/75 backdrop-blur-md">
                <table className="w-full border-collapse">
                  <thead className="bg-[#e5ebde]/65 border-b border-white/40">
                    <tr>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-16">NO.</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[200px]">DAFTAR TUGAS</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[150px]">SISA WAKTU</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-48">DEADLINE</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-32">KETERANGAN</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[250px]">PENJELASAN</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-36">LINK TUGAS</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-36">PENGUMPULAN</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-64 min-w-[220px]">PROGRESS</th>
                      <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[250px]">TUGAS SAYA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {tasks.filter(t => t.type === 'assignment').length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-6 py-20 text-center">
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center">
                              <PieChart className="w-8 h-8 text-zinc-200" />
                            </div>
                            <p className="text-xs font-black uppercase tracking-widest text-zinc-300 italic">No assignments logged in your system memory</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      tasks
                        .filter(t => t.type === 'assignment')
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map((task, index) => {
                          const deadline = new Date(task.date);
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const diffTime = deadline.getTime() - today.getTime();
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                          
                          const sisaWaktuLabel = diffDays === 0 ? 'HARI INI' : (diffDays > 0 ? `${diffDays} HARI LAGI` : `${Math.abs(diffDays)} HARI TELAT`);
                          const isOverdue = diffDays < 0;

                          const isCompleted = task.status === 'Sudah Dikumpul';

                          const getTimeColor = () => {
                            if (isCompleted) return 'text-emerald-600';
                            if (diffDays < 0) return 'text-rose-600 line-through opacity-70';
                            if (diffDays === 0) return 'text-rose-500 bg-rose-50 px-2 py-1 rounded-lg animate-pulse shadow-sm';
                            if (diffDays === 1) return 'text-rose-400 font-black';
                            if (diffDays === 2) return 'text-orange-500';
                            if (diffDays === 3) return 'text-amber-500';
                            return 'text-blue-500';
                          };

                          return (
                            <motion.tr 
                              key={task.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className={`transition-all cursor-pointer group ${isCompleted ? 'bg-emerald-50/60 hover:bg-emerald-100/60' : 'hover:bg-zinc-50/50'}`}
                              onClick={() => {
                                setSelectedTaskId(task.id);
                              }}
                            >
                              <td className="px-6 py-5 text-[10px] font-black text-zinc-400 text-center">{index + 1}</td>
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-3">
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: task.color }} />
                                  <p className={`text-xs font-black uppercase tracking-tight truncate max-w-[120px] ${isCompleted ? 'text-emerald-900' : ''}`}>{task.title}</p>
                                </div>
                              </td>
                              <td className={`px-6 py-5 text-[9px] font-black text-center ${getTimeColor()}`}>
                                {isCompleted ? 'TERSELESAIKAN' : sisaWaktuLabel}
                              </td>
                              <td className={`px-6 py-5 text-[9px] font-black uppercase tracking-tight text-center ${isCompleted ? 'text-emerald-700' : 'text-zinc-500'}`}>
                                {new Date(task.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                              </td>
                              <td className="px-6 py-5 text-center">
                                <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest whitespace-nowrap ${
                                  task.category === 'Individu' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 
                                  task.category === 'Kelompok' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 
                                  'bg-zinc-100 text-zinc-500'
                                }`}>
                                  {task.category || 'Individu'}
                                </span>
                              </td>
                              <td className="px-6 py-5 text-center">
                                <p className={`text-[9px] italic line-clamp-1 max-w-[150px] font-mono ${isCompleted ? 'text-emerald-600' : 'text-zinc-400'}`}>
                                  {task.description || '-'}
                                </p>
                              </td>
                              <td className="px-6 py-5 text-center">
                                {task.taskLink ? (
                                  <a 
                                    href={task.taskLink} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="text-blue-500 hover:underline text-[9px] font-black uppercase truncate max-w-[100px] block"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    LINK TUGAS
                                  </a>
                                ) : <span className="text-zinc-200">-</span>}
                              </td>
                              <td className="px-6 py-5 text-center">
                                {task.submissionLink ? (
                                  <a 
                                    href={task.submissionLink} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="text-purple-500 hover:underline text-[9px] font-black uppercase truncate max-w-[100px] block"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    LINK PENGUMPULAN
                                  </a>
                                ) : <span className="text-zinc-200">-</span>}
                              </td>
                              <td className="px-6 py-5 text-center" onClick={e => e.stopPropagation()}>
                                <select 
                                  value={task.status || 'Belum Dikumpul'}
                                  onChange={(e) => updateTaskProgress(task.id, e.target.value)}
                                  className={`w-full max-w-[200px] mx-auto px-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tight border-0 outline-none cursor-pointer transition-all shadow-sm text-center appearance-none ${
                                    task.status === 'Sudah Dikumpul' ? 'bg-emerald-500 text-white shadow-emerald-100' : 
                                    task.status === 'Dalam Proses' ? 'bg-amber-400 text-white shadow-amber-50' : 
                                    'bg-rose-500 text-white shadow-rose-50'
                                  }`}
                                >
                                  <option className="text-zinc-900 bg-white" value="Belum Dikumpul">BELUM DIKUMPUL</option>
                                  <option className="text-zinc-900 bg-white" value="Dalam Proses">DALAM PROSES</option>
                                  <option className="text-zinc-900 bg-white" value="Sudah Dikumpul">SUDAH DIKUMPUL</option>
                                </select>
                              </td>
                              <td className="px-6 py-5 text-center" onClick={e => e.stopPropagation()}>
                                <div className="relative group max-w-[200px] mx-auto">
                                  <input 
                                    placeholder="LINK TUGAS / CATATAN..."
                                    value={task.myNote || ''}
                                    onChange={(e) => updateTaskProgress(task.id, task.status, e.target.value)}
                                    className={`w-full p-3 pr-10 rounded-2xl text-[9px] font-mono italic outline-none transition-all border-0 ${
                                      isNight 
                                        ? 'bg-white/5 text-zinc-300 placeholder:text-zinc-600 focus:bg-white/10 focus:ring-2 focus:ring-white/20' 
                                        : 'bg-zinc-50 text-zinc-600 focus:bg-white focus:ring-2 focus:ring-blue-100'
                                    } ${isCompleted ? 'text-emerald-600' : ''}`}
                                  />
                                  {(task.myNote?.startsWith('http://') || task.myNote?.startsWith('https://')) && (
                                    <a 
                                      href={task.myNote} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-600 transition-colors"
                                      title="Buka Link"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>
                            </motion.tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pb-32" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-8 sm:p-12 overflow-y-auto no-scrollbar bg-transparent">
            <div className="max-w-4xl mx-auto w-full space-y-12 pb-32">
              <div className="flex flex-col gap-12">
                {/* Group Hub / Center */}
                <div className="space-y-12">
                  {!viewingGroupId ? (
                    <>
                      {/* Hub Dashboard View */}
                      <div className="space-y-8">
                        <header className="flex flex-col gap-2">
                            <h3 className="text-[14px] font-black uppercase tracking-[0.3em] text-[#1a2e05] italic">Group Command Hub</h3>
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#2d3a22]/70">Coordinated communication and scheduling across groups</p>
                        </header>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                          {/* Left Panel: Initialization */}
                          <div className="lg:col-span-5 p-6 sm:p-10 rounded-[32px] sm:rounded-[48px] bg-white/75 border border-white/25 shadow-2xl space-y-8 backdrop-blur-lg">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-3xl bg-[#e5ebde] flex items-center justify-center text-matcha-700">
                                <Zap className="w-6 h-6 fill-current" />
                              </div>
                              <div>
                                <h4 className="text-lg font-black uppercase tracking-tight text-[#1a2e05] italic">Initialize Group</h4>
                                <p className="text-[8px] font-black uppercase tracking-widest text-matcha-700/60">Secure entry to group networks</p>
                              </div>
                            </div>
                            
                            <div className="space-y-6">
                              <form onSubmit={createGroup} className="flex flex-col gap-3">
                                <p className="text-[8px] font-black uppercase tracking-widest text-matcha-800 ml-2">Designate New Group</p>
                                <div className="relative group">
                                  <input 
                                    type="text" 
                                    placeholder="GROUP NAME..." 
                                    value={groupName}
                                    onChange={e => setGroupName(e.target.value)}
                                    className="w-full bg-white/50 border-2 border-zinc-200/80 focus:border-matcha-600 focus:bg-white rounded-3xl py-5 px-6 text-[11px] font-black uppercase tracking-widest text-zinc-900 outline-none transition-all placeholder:text-zinc-400"
                                  />
                                  <button type="submit" className="absolute right-3 top-3 bottom-3 aspect-square bg-matcha-600 text-white rounded-2xl flex items-center justify-center hover:bg-matcha-700 hover:scale-105 active:scale-95 transition-all shadow-md shadow-matcha-600/10">
                                    <Plus className="w-5 h-5" />
                                  </button>
                                </div>
                              </form>

                              <div className="flex items-center gap-4 py-2">
                                <div className="h-[1px] flex-1 bg-zinc-200" />
                                <span className="text-[9px] font-bold text-zinc-500 tracking-widest">COMM-LINK</span>
                                <div className="h-[1px] flex-1 bg-zinc-200" />
                              </div>

                              <form onSubmit={joinGroup} className="flex flex-col gap-3">
                                <p className="text-[8px] font-black uppercase tracking-widest text-matcha-800 ml-2">Established Frequency Sink</p>
                                <div className="relative group">
                                  <input 
                                    type="text" 
                                    placeholder="ACCESS CODE..." 
                                    value={joinCode}
                                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                                    className="w-full bg-white/50 border-2 border-zinc-200/80 focus:border-matcha-600 focus:bg-white rounded-3xl py-5 px-6 text-[11px] font-black uppercase tracking-widest text-zinc-900 outline-none transition-all placeholder:text-zinc-400"
                                  />
                                  <button type="submit" className="absolute right-3 top-3 bottom-3 aspect-square bg-matcha-600 text-white rounded-2xl flex items-center justify-center hover:bg-matcha-700 hover:scale-105 active:scale-95 transition-all shadow-md shadow-matcha-600/10">
                                    <LogIn className="w-5 h-5" />
                                  </button>
                                </div>
                              </form>
                            </div>
                          </div>

                          {/* Right Panel: Group List */}
                          <div className="lg:col-span-7 space-y-6">
                            <div className="flex items-center justify-between px-2">
                              <h4 className="text-[10px] font-black uppercase tracking-widest text-[#1a2e05] opacity-80">Available Groups</h4>
                              <span className="text-[9px] font-mono font-black text-[#1a2e05] opacity-70 bg-white/40 px-3 py-1 rounded-full">{groups.length} DETECTED</span>
                            </div>
                            <div className="grid grid-cols-1 gap-5">
                              {groups.length === 0 ? (
                                <div className="p-8 sm:p-20 bg-white/40 border-2 border-dashed border-white/30 rounded-[32px] sm:rounded-[48px] text-center space-y-4 backdrop-blur-md">
                                  <Users className="w-12 h-12 mx-auto opacity-10 text-zinc-900" />
                                  <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500 italic">No active groups established</p>
                                </div>
                              ) : (
                                groups.map(g => (
                                  <motion.div 
                                    layout
                                    key={g.id}
                                    onClick={() => setViewingGroupId(g.id)}
                                    className="p-5 sm:p-6 rounded-[32px] sm:rounded-[40px] bg-white/75 border border-white/20 hover:border-matcha-600 hover:shadow-2xl hover:shadow-matcha-605/10 transition-all group flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-6 cursor-pointer backdrop-blur-md"
                                  >
                                    <div className="flex items-center gap-4 flex-1">
                                      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-[24px] sm:rounded-[28px] bg-gradient-to-tr from-matcha-900 to-matcha-700 flex items-center justify-center text-white text-lg sm:text-xl font-black italic shadow-xl shadow-matcha-800/10 shrink-0">
                                        {g.name[0].toUpperCase()}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h5 className="text-[13px] font-black uppercase tracking-tight text-zinc-900 group-hover:text-matcha-600 transition-colors truncate">{g.name}</h5>
                                        <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
                                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                            {(g.members || []).length} Members
                                          </span>
                                          <div className="w-1 h-1 rounded-full bg-zinc-200" />
                                          <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase">{g.id.slice(-6)}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 sm:gap-3 border-t sm:border-t-0 border-zinc-100 sm:border-transparent pt-3 sm:pt-0">
                                      <div className="px-3 py-1 bg-[#e5ebde]/80 border border-white/25 rounded-full text-[8px] font-black tracking-widest text-matcha-750">
                                        SECURE LINK
                                      </div>
                                      <span className="text-[11px] font-mono font-black text-matcha-600 tracking-tighter">{g.code}</span>
                                    </div>
                                  </motion.div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Detailed Group Page (Replaces Social Hub View) */
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="space-y-12 pb-32"
                    >
                      {/* Header Section */}
                      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div className="space-y-6">
                           <button 
                             onClick={() => setViewingGroupId(null)}
                             className="flex items-center gap-3 group text-[#1a2e05] opacity-80 hover:opacity-100 hover:text-black transition-colors"
                           >
                             <ChevronLeft className="w-6 h-6 group-hover:-translate-x-2 transition-transform" />
                             <span className="text-[11px] font-black uppercase tracking-[0.3em]">Go Back to Hub</span>
                           </button>
                           <div className="flex items-center gap-8">
                             <div className="w-20 h-20 rounded-[32px] bg-gradient-to-tr from-matcha-900 via-matcha-700 to-matcha-600 border-4 border-white flex items-center justify-center text-white text-3xl font-black italic shadow-2xl shadow-matcha-900/10">
                               {groups.find(g => g.id === viewingGroupId)?.name[0].toUpperCase()}
                             </div>
                             <div>
                                 <h2 className="text-5xl font-black uppercase italic tracking-tighter leading-none text-zinc-900">
                                   {groups.find(g => g.id === viewingGroupId)?.name}
                                 </h2>
                                 <div className="flex items-center gap-3 mt-3">
                                   <div className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-[9px] font-black uppercase tracking-widest text-amber-600">
                                     GROUP ACTIVE
                                   </div>
                                   <div className="px-3 py-1 bg-white/50 border border-white/40 rounded-full text-[9px] font-mono font-bold text-matcha-900">
                                     FREQ: {groups.find(g => g.id === viewingGroupId)?.code}
                                   </div>
                                </div>
                            </div>
                          </div>
                        </div>

                        <div className="p-2 bg-white/40 rounded-[24px] sm:rounded-[40px] border border-white/50 backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2 shadow-sm w-full sm:w-auto">
                           {[
                             { id: 'tasks', label: 'Schedules', icon: LayoutGrid },
                             { id: 'schedule', label: 'Schedule', icon: CalendarIcon },
                             { id: 'members', label: 'Crew', icon: Users },
                           ].map((tab) => (
                             <button 
                              key={tab.id}
                              onClick={() => setGroupViewTab(tab.id as any)}
                              className={`px-4 sm:px-8 py-3.5 sm:py-4 rounded-[18px] sm:rounded-[30px] text-[10px] sm:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all w-full sm:w-auto ${
                                groupViewTab === tab.id 
                                  ? 'bg-matcha-600 text-white scale-[1.02] sm:scale-105 shadow-md shadow-matcha-700/25' 
                                  : 'text-matcha-900/60 hover:bg-white/60 hover:text-matcha-950/90'
                              }`}
                             >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                             </button>
                           ))}

                        </div>
                      </div>

                      {/* Squadron Member Management Interface */}
                      {groupViewTab === 'members' && (
                        <div className="space-y-8">
                          <div className="flex items-center justify-between border-b-2 border-zinc-100 pb-6">
                             <h4 className="text-[11px] font-black uppercase tracking-[0.4em] text-[#1a2e05]/80 flex items-center gap-4 italic font-sans">
                                <Users className="w-5 h-5 text-[#2d3a22]" /> Crew Synchronization Monitor
                             </h4>
                             <span className="text-[9px] font-black bg-matcha-700 text-white px-4 py-2 rounded-2xl uppercase tracking-[0.2em] italic shadow-md shadow-matcha-700/10">
                               {(groups.find(g => g.id === viewingGroupId)?.members || []).length} Units Online
                             </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {(groups.find(g => g.id === viewingGroupId)?.members || []).map((uid) => {
                              const group = groups.find(g => g.id === viewingGroupId);
                              if (!group) return null;
                              const isOwner = group.creatorUid === uid;
                              const isAdmin = group.admins?.includes(uid);
                              const currentUserUid = user?.uid;
                              const currentIsOwner = group.creatorUid === currentUserUid;
                              const currentIsAdmin = group.admins?.includes(currentUserUid!);

                              return (
                                <div key={uid} className="p-6 rounded-[36px] bg-white/70 border border-white/20 shadow-sm flex items-center justify-between group transition-all hover:shadow-xl hover:shadow-white/20 backdrop-blur-sm">
                                  <div className="flex items-center gap-5">
                                    <div className={`w-14 h-14 rounded-full flex items-center justify-center border-4 border-white shadow-xl ${
                                      isOwner ? 'bg-amber-400 text-black' : 
                                      isAdmin ? 'bg-blue-600 text-white' : 
                                      'bg-zinc-100 text-zinc-400'
                                    }`}>
                                      {uid === user?.uid ? <UserIcon className="w-7 h-7" /> : <div className="text-xs font-black">OP</div>}
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-[11px] font-black uppercase tracking-tight text-zinc-900 truncate max-w-[100px]">
                                        {uid === user?.uid ? 'YOU' : 'OPERATOR'}
                                        {uid === user?.uid && <span className="ml-2 text-blue-500 font-black tracking-widest">(SELF)</span>}
                                      </span>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg ${
                                          isOwner ? 'bg-amber-100 text-amber-700' : 
                                          isAdmin ? 'bg-blue-100 text-blue-700' : 
                                          'bg-zinc-100 text-zinc-400'
                                        }`}>
                                          {isOwner ? 'OWNER' : isAdmin ? 'ADMIN' : 'MEMBER'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {uid !== currentUserUid && (currentIsOwner || currentIsAdmin) && (
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                      {!isAdmin ? (
                                        <button 
                                          onClick={() => promoteToAdmin(group.id, uid)}
                                          className="p-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition-colors"
                                          title="Promote to Admin"
                                        >
                                          <Plus className="w-4 h-4" />
                                        </button>
                                      ) : (
                                        currentIsOwner && !isOwner && (
                                          <button 
                                            onClick={() => demoteAdmin(group.id, uid)}
                                            className="p-3 bg-zinc-50 text-zinc-400 rounded-2xl hover:bg-rose-50 hover:text-rose-500 transition-colors"
                                            title="Revoke Admin"
                                          >
                                            <XCircle className="w-4 h-4" />
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* List Tugas View */}
                      {groupViewTab === 'tasks' && (
                        <div className="space-y-8">
                          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b-2 border-zinc-100 pb-8">
                            <h4 className="text-[14px] font-black uppercase tracking-[0.3em] flex items-center gap-3 italic text-[#1a2e05]">
                               <LayoutGrid className="w-5 h-5 text-matcha-600" /> Schedule List (Tugas)
                            </h4>
                            {(() => {
                              const group = groups.find(g => g.id === viewingGroupId);
                              const isAuthorized = group && (!user || group.creatorUid === user?.uid || group.admins?.includes(user?.uid || ''));
                              if (!isAuthorized) return null;
                              
                              return (
                                <button 
                                  onClick={() => openAssignmentForm(undefined, viewingGroupId || undefined)}
                                  className="group flex items-center gap-3 px-8 py-4 bg-matcha-600 text-white rounded-[20px] font-black text-[10px] uppercase tracking-[0.2em] hover:bg-matcha-700 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-matcha-600/25"
                                >
                                  <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                                  Initialize Assignment
                                </button>
                              );
                            })()}
                          </div>

                        {/* Status Stats - Matching Recap exactly */}
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4">
                          {(() => {
                            const group = groups.find(g => g.id === viewingGroupId);
                            const groupTasks = tasks.filter(t => t.type === 'assignment' && t.groupId === viewingGroupId);
                            const pendingAssignments = groupTasks.filter(t => t.status !== 'Sudah Dikumpul');
                            
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            
                            const urgentTasks = pendingAssignments.filter(t => {
                              const d = new Date(t.date);
                              const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                              return diff <= 1;
                            });
                            
                            const warningTasks = pendingAssignments.filter(t => {
                              const d = new Date(t.date);
                              const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                              return diff > 1 && diff <= 3;
                            });

                            return (
                              <>
                                <div className="p-3 sm:p-6 rounded-[16px] sm:rounded-[32px] bg-rose-50/70 border border-rose-100/60 flex items-center gap-3 sm:gap-4 shadow-sm flex-1 backdrop-blur-md">
                                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-rose-500 flex items-center justify-center text-white font-black text-sm sm:text-xl italic animate-pulse flex-shrink-0 font-sans">
                                    {urgentTasks.length}
                                  </div>
                                  <div>
                                    <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-rose-500 leading-tight">Urgent Status</p>
                                    <p className="text-[7px] sm:text-[8px] font-bold text-rose-400 uppercase tracking-tight">Today / Tomorrow</p>
                                  </div>
                                </div>
                                <div className="p-3 sm:p-6 rounded-[16px] sm:rounded-[32px] bg-amber-50/70 border border-amber-100/60 flex items-center gap-3 sm:gap-4 shadow-sm flex-1 backdrop-blur-md">
                                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-amber-500 flex items-center justify-center text-white font-black text-sm sm:text-xl italic flex-shrink-0 font-sans">
                                    {warningTasks.length}
                                  </div>
                                  <div>
                                    <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-amber-500 leading-tight">Warning Status</p>
                                    <p className="text-[7px] sm:text-[8px] font-bold text-amber-400 uppercase tracking-tight">Deadline 2-3 Days</p>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <div className="w-full overflow-x-auto no-scrollbar">
                           <div className="min-w-[1600px] bg-white/75 border border-white/20 rounded-[48px] overflow-hidden backdrop-blur-md">
                             <table className="w-full border-collapse">
                               <thead className="bg-[#e5ebde]/65 border-b border-white/40">
                                 <tr>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-16">NO.</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[200px]">DAFTAR TUGAS</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[150px]">SISA WAKTU</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-48">DEADLINE</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-32">KETERANGAN</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[250px]">PENJELASAN</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-36">LINK TUGAS</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-36">PENGUMPULAN</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-64 min-w-[220px]">PROGRESS</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 min-w-[250px]">TUGAS SAYA</th>
                                   <th className="px-6 py-8 text-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 w-20">AKSI</th>
                                 </tr>
                               </thead>
                               <tbody className="divide-y divide-zinc-50">
                                 {(() => {
                                   const group = groups.find(g => g.id === viewingGroupId);
                                   const groupTasks = tasks.filter(t => t.type === 'assignment' && t.groupId === viewingGroupId);
                                   
                                   if (groupTasks.length === 0) {
                                     return (
                                       <tr>
                                         <td colSpan={10} className="px-6 py-32 text-center text-[10px] font-black uppercase tracking-[0.3em] text-zinc-200 italic">No group assignments registered in sector memory</td>
                                       </tr>
                                     );
                                   }

                                   return groupTasks
                                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                    .map((task, index) => {
                                      const deadline = new Date(task.date);
                                      const today = new Date();
                                      today.setHours(0, 0, 0, 0);
                                      const diffTime = deadline.getTime() - today.getTime();
                                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                      
                                      const sisaWaktuLabel = diffDays === 0 ? 'HARI INI' : (diffDays > 0 ? `${diffDays} HARI LAGI` : `${Math.abs(diffDays)} HARI TELAT`);
                                      const isCompleted = task.status === 'Sudah Dikumpul';

                                      const getTimeColor = () => {
                                        if (isCompleted) return 'text-emerald-600';
                                        if (diffDays < 0) return 'text-rose-600 line-through opacity-70';
                                        if (diffDays === 0) return 'text-rose-500 bg-rose-50 px-2 py-1 rounded-lg animate-pulse shadow-sm';
                                        if (diffDays === 1) return 'text-rose-400 font-black';
                                        if (diffDays === 2) return 'text-orange-500';
                                        if (diffDays === 3) return 'text-amber-500';
                                        return 'text-blue-500';
                                      };

                                      return (
                                        <tr 
                                          key={task.id} 
                                          className={`group hover:bg-zinc-50 transition-all cursor-pointer ${isCompleted ? 'bg-emerald-50/60' : ''}`}
                                          onClick={() => setSelectedTaskId(task.id)}
                                        >
                                          <td className="px-6 py-6 text-[10px] font-black text-zinc-400 text-center">{index + 1}</td>
                                          <td className="px-6 py-6">
                                            <div className="flex items-center gap-4">
                                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: task.color }} />
                                              <span className="text-[11px] font-black uppercase tracking-tight text-zinc-900 truncate max-w-[150px]">{task.title}</span>
                                            </div>
                                          </td>
                                          <td className={`px-6 py-6 text-[9px] font-black text-center ${getTimeColor()}`}>
                                            {isCompleted ? 'TERSELESAIKAN' : sisaWaktuLabel}
                                          </td>
                                          <td className={`px-6 py-6 text-center text-[9px] font-black uppercase text-zinc-500 ${isCompleted ? 'text-emerald-700' : ''}`}>
                                            {new Date(task.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                          </td>
                                          <td className="px-6 py-6 text-center">
                                            <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest whitespace-nowrap ${
                                              task.category === 'Individu' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 
                                              task.category === 'Kelompok' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 
                                              'bg-zinc-100 text-zinc-500'
                                            }`}>
                                              {task.category || 'Individu'}
                                            </span>
                                          </td>
                                          <td className="px-6 py-6 text-center">
                                            <p className={`text-[9px] italic line-clamp-1 max-w-[150px] font-mono ${isCompleted ? 'text-emerald-600' : 'text-zinc-400'}`}>
                                              {task.description || '-'}
                                            </p>
                                          </td>
                                          <td className="px-6 py-6 text-center">
                                            {task.taskLink ? (
                                              <a href={task.taskLink} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-[9px] font-black uppercase truncate max-w-[100px] block" onClick={e => e.stopPropagation()}>
                                                LINK TUGAS
                                              </a>
                                            ) : <span className="text-zinc-200">-</span>}
                                          </td>
                                          <td className="px-6 py-6 text-center">
                                            {task.submissionLink ? (
                                              <a href={task.submissionLink} target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:underline text-[9px] font-black uppercase truncate max-w-[100px] block" onClick={e => e.stopPropagation()}>
                                                LINK PENGUMPULAN
                                              </a>
                                            ) : <span className="text-zinc-200">-</span>}
                                          </td>
                                          <td className="px-6 py-6 text-center" onClick={e => e.stopPropagation()}>
                                            <select 
                                              value={task.status || 'Belum Dikumpul'}
                                              onChange={(e) => updateTaskProgress(task.id, e.target.value)}
                                              className={`w-full max-w-[200px] mx-auto px-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tight border-0 outline-none cursor-pointer transition-all shadow-sm text-center appearance-none ${
                                                task.status === 'Sudah Dikumpul' ? 'bg-emerald-500 text-white shadow-emerald-100' : 
                                                task.status === 'Dalam Proses' ? 'bg-amber-400 text-white shadow-amber-50' : 
                                                'bg-rose-500 text-white shadow-rose-50'
                                              }`}
                                            >
                                              <option className="text-zinc-900 bg-white" value="Belum Dikumpul">BELUM DIKUMPUL</option>
                                              <option className="text-zinc-900 bg-white" value="Dalam Proses">DALAM PROSES</option>
                                              <option className="text-zinc-900 bg-white" value="Sudah Dikumpul">SUDAH DIKUMPUL</option>
                                            </select>
                                          </td>
                                          <td className="px-6 py-6 text-center" onClick={e => e.stopPropagation()}>
                                            <div className="relative group max-w-[200px] mx-auto">
                                              <input 
                                                placeholder="LINK TUGAS / CATATAN..."
                                                value={task.myNote || ''}
                                                onChange={(e) => updateTaskProgress(task.id, task.status, e.target.value)}
                                                className={`w-full p-3 pr-10 rounded-2xl text-[9px] font-mono italic outline-none transition-all border-0 ${
                                                  isNight 
                                                    ? 'bg-white/5 text-zinc-300 placeholder:text-zinc-600 focus:bg-white/10 focus:ring-2 focus:ring-white/20' 
                                                    : 'bg-zinc-50 text-zinc-600 focus:bg-white focus:ring-2 focus:ring-blue-100'
                                                } ${isCompleted ? 'text-emerald-600' : ''}`}
                                              />
                                              {(task.myNote?.startsWith('http://') || task.myNote?.startsWith('https://')) && (
                                                <a 
                                                  href={task.myNote} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer"
                                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-600 transition-colors"
                                                  title="Buka Link"
                                                >
                                                  <ExternalLink className="w-3.5 h-3.5" />
                                                </a>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-6 py-6 text-center" onClick={e => e.stopPropagation()}>
                                            {(task.ownerUid === user?.uid || (groups.find(g => g.id === viewingGroupId)?.creatorUid === user?.uid) || (groups.find(g => g.id === viewingGroupId)?.admins?.includes(user?.uid || ''))) && (
                                              <button 
                                                onClick={async () => {
                                                  if (window.confirm(`Hapus misi "${task.title}"?`)) {
                                                    await removeTask(task.id);
                                                  }
                                                }}
                                                className="p-3 text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                   });
                                 })()}
                               </tbody>
                             </table>
                           </div>
                        </div>
                      </div>
                      )}

                      {/* Class Schedule View */}
                      {groupViewTab === 'schedule' && (
                        <div className="space-y-10">
                          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b-2 border-zinc-100 pb-8">
                            <div className="space-y-2">
                               <h4 className="text-[16px] font-black uppercase tracking-[0.4em] flex items-center gap-4 italic text-zinc-900 group/title">
                                  <CalendarIcon className="w-6 h-6 text-amber-500" /> 
                                  {(() => {
                                    const group = groups.find(g => g.id === viewingGroupId);
                                    const currentTitle = group?.scheduleTitle || 'Academic Ops Sync';
                                    const isAuthorized = group && (!user || group.creatorUid === user?.uid || group.admins?.includes(user?.uid || ''));

                                    if (isEditingScheduleTitle) {
                                      return (
                                        <div className="flex items-center gap-2">
                                          <input
                                            autoFocus
                                            type="text"
                                            value={tempScheduleTitle}
                                            onChange={(e) => setTempScheduleTitle(e.target.value)}
                                            onKeyDown={async (e) => {
                                              if (e.key === 'Enter' && viewingGroupId) {
                                                try {
                                                  await updateDoc(doc(db, 'groups', viewingGroupId), { scheduleTitle: tempScheduleTitle });
                                                  setIsEditingScheduleTitle(false);
                                                } catch (err) {
                                                  handleFirestoreError(err, OperationType.UPDATE, `groups/${viewingGroupId}`);
                                                }
                                              }
                                              if (e.key === 'Escape') setIsEditingScheduleTitle(false);
                                            }}
                                            className={`px-3 py-1 rounded-xl outline-none normal-case tracking-normal not-italic font-bold text-[14px] w-64 transition-all ${
                                              isNight 
                                                ? 'bg-white/10 text-white' 
                                                : 'bg-zinc-100 text-zinc-900'
                                            }`}
                                          />
                                          <div className="flex items-center gap-1">
                                            <button 
                                              onClick={async () => {
                                                if (viewingGroupId) {
                                                  try {
                                                    await updateDoc(doc(db, 'groups', viewingGroupId), { scheduleTitle: tempScheduleTitle });
                                                    setIsEditingScheduleTitle(false);
                                                  } catch (err) {
                                                    handleFirestoreError(err, OperationType.UPDATE, `groups/${viewingGroupId}`);
                                                  }
                                                }
                                              }}
                                              className="p-1 hover:bg-emerald-50 rounded-lg text-emerald-500 transition-colors"
                                            >
                                              <Check className="w-4 h-4" />
                                            </button>
                                            <button 
                                              onClick={() => setIsEditingScheduleTitle(false)}
                                              className="p-1 hover:bg-rose-50 rounded-lg text-rose-500 transition-colors"
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div className="flex items-center gap-3">
                                        <span>{currentTitle}</span>
                                        {isAuthorized && (
                                          <button 
                                            onClick={() => {
                                              setTempScheduleTitle(currentTitle);
                                              setIsEditingScheduleTitle(true);
                                            }}
                                            className="opacity-0 group-hover/title:opacity-100 transition-opacity p-2 hover:bg-zinc-100 rounded-xl text-zinc-400 hover:text-zinc-900"
                                          >
                                            <Edit2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
                               </h4>
                               <p className="text-[10px] font-black uppercase tracking-widest text-[#2d3a22]/70 pl-10 flex items-center gap-2">
                                 <Clock className="w-3 h-3" /> System Date: {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()}
                               </p>
                            </div>
                            {(() => {
                              const group = groups.find(g => g.id === viewingGroupId);
                              const isAuthorized = group && (!user || group.creatorUid === user?.uid || group.admins?.includes(user?.uid || ''));
                              if (!isAuthorized) return null;
                              
                               return (
                                 <div className="flex items-center gap-3">
                                   <button 
                                     onClick={() => openScheduleEditor()}
                                     className="group flex items-center gap-3 px-8 py-4 bg-amber-500 text-white rounded-[24px] font-black text-[10px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-xl shadow-amber-100"
                                   >
                                     <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                                     Initialize Entry
                                   </button>
                                   <button 
                                     onClick={() => clearAllSchedule(viewingGroupId!)}
                                     className="group flex items-center gap-3 px-8 py-4 bg-rose-50 text-rose-500 rounded-[24px] font-black text-[10px] uppercase tracking-[0.2em] hover:bg-rose-500 hover:text-white transition-all border border-rose-100"
                                   >
                                     <Trash2 className="w-4 h-4" />
                                     Hapus Seluruh Jadwal
                                   </button>
                                 </div>
                               );
                            })()}
                          </div>

                          <div className="w-full overflow-x-auto no-scrollbar">
                            <div className="min-w-[1400px] bg-white/75 border border-white/25 rounded-[48px] overflow-hidden backdrop-blur-md">
                              <table className="w-full border-collapse">
                                <thead className="bg-[#e5ebde]/65 backdrop-blur-sm text-zinc-700 border-b border-white/40">
                                  <tr>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 w-32">HARI</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 min-w-[220px]">MATA KULIAH</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 w-28 font-mono">SECARA</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 w-44">WAKTU</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 min-w-[320px]">DOSEN PENGAMPU</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 w-32">TUGAS</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] border-r border-zinc-200/50 w-24">BOBOT SKS</th>
                                    <th className="px-6 py-10 text-center text-[10px] font-black uppercase tracking-[0.3em] w-28">DURASI</th>
                                  </tr>
                                </thead>
                <tbody className="divide-y divide-zinc-100 italic">
                                  {(() => {
                                    const group = groups.find(g => g.id === viewingGroupId);
                                    const isAuthorized = group && (!user || group.creatorUid === user?.uid || group.admins?.includes(user?.uid || ''));
                                    const rawSchedule = group?.schedule || DEFAULT_SCHEDULE;
                                    
                                    // Attach original index before filtering
                                    const scheduleWithIndices = rawSchedule.map((item, index) => ({ 
                                      ...item, 
                                      originalIndex: index 
                                    }));
                                    
                                    const days = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU']
                                      .filter(d => scheduleWithIndices.some(i => i.day === d));

                                    return days.flatMap(d => {
                                      const dayItems = scheduleWithIndices.filter(i => i.day === d);
                                      return dayItems.map((item, idx) => (
                                        <tr 
                                          key={`schedule-${item.id || item.originalIndex}-${idx}`} 
                                          onClick={() => setSelectedTaskId(item.id || `schedule-${viewingGroupId}-${item.subject}-${item.startTime}`)}
                                          className="group hover:bg-zinc-50 transition-all font-sans font-medium text-zinc-500 shadow-sm cursor-pointer relative"
                                        >
                                          {idx === 0 && (
                                            <td rowSpan={dayItems.length} className="px-6 py-10 bg-zinc-50 border-r border-zinc-100 text-center">
                                              <span className="text-sm font-black uppercase text-zinc-900 border-b-2 border-zinc-900 pb-1">{d}</span>
                                            </td>
                                          )}
                                          <td className="px-10 py-10 border-r border-zinc-100 relative">
                                            <div className="flex items-center gap-4">
                                              <div className={`w-1.5 h-6 rounded-full ${item.modality === 'Online' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                                              <span className="text-sm font-black uppercase tracking-tight text-zinc-900">{item.subject}</span>
                                            </div>
                                          </td>
                                          <td className="px-6 py-10 border-r border-zinc-100 text-center font-mono text-[9px] font-black">
                                            <span className={`px-4 py-1.5 rounded-xl ${item.modality === 'Online' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                              {item.modality}
                                            </span>
                                          </td>
                                          <td className="px-6 py-10 border-r border-zinc-100 text-center font-mono text-[11px] font-black text-zinc-900">
                                            {item.startTime} - {item.endTime}
                                          </td>
                                          <td className="px-8 py-10 border-r border-zinc-100 whitespace-pre-line text-[10px] leading-relaxed font-bold tracking-tight text-zinc-400">
                                            {item.lecturers.join('\n')}
                                          </td>
                                          <td className="px-6 py-10 border-r border-zinc-100 text-center">
                                            {(() => {
                                              const assignmentsCount = tasks.filter(t => t.type === 'assignment' && t.groupId === viewingGroupId && t.title.toLowerCase().includes(item.subject.toLowerCase())).length;
                                              return (
                                                <div className="flex flex-col gap-1 items-center">
                                                  <span className="text-[10px] font-black text-zinc-900">{assignmentsCount}</span>
                                                  <span className="text-[8px] uppercase tracking-widest text-zinc-400">Tasks</span>
                                                </div>
                                              );
                                            })()}
                                          </td>
                                          <td className="px-6 py-10 border-r border-zinc-100 text-center text-xs font-black text-zinc-900">
                                            {item.sks} SKS
                                          </td>
                                          <td className="px-6 py-10 text-center text-xs font-black text-zinc-400 relative">
                                            {item.duration}
                                          </td>
                                        </tr>
                                      ))
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Instagram-style Bottom Navigation Bar */}
        <nav className={`fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md h-16 rounded-full border flex items-center justify-around px-6 z-[80] transition-all duration-500 shadow-2xl ${
          isAnyModalOpen ? 'opacity-0 pointer-events-none translate-y-10 scale-95' : ''
        } ${
          isNight 
            ? 'bg-zinc-950/20 border-white/10 backdrop-blur-3xl shadow-3d-dark' 
            : 'bg-white/45 border-white/50 backdrop-blur-xl shadow-3d-light'
        }`}>
          <button
            onClick={() => {
              setCurrentTab('dashboard');
              setViewingGroupId(null);
            }}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all ${
              currentTab === 'dashboard' 
                ? (isNight ? 'text-matcha-400 scale-110' : 'text-matcha-600 scale-110') 
                : 'text-matcha-400/80 hover:text-matcha-600'
            }`}
          >
            <LayoutGrid className={currentTab === 'dashboard' ? (isNight ? "w-6 h-6 fill-matcha-400 text-matcha-400" : "w-6 h-6 fill-matcha-600 text-matcha-600") : "w-6 h-6"} strokeWidth={currentTab === 'dashboard' ? 2.5 : 2} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">Home</span>
          </button>
          <button
            onClick={() => {
              setCurrentTab('recap');
              setViewingGroupId(null);
            }}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all ${
              currentTab === 'recap' 
                ? (isNight ? 'text-matcha-400 scale-110' : 'text-matcha-600 scale-110') 
                : 'text-matcha-400/80 hover:text-matcha-600'
            }`}
          >
            <PieChart className={currentTab === 'recap' ? (isNight ? "w-6 h-6 fill-matcha-400 text-matcha-400" : "w-6 h-6 fill-matcha-600 text-matcha-600") : "w-6 h-6"} strokeWidth={currentTab === 'recap' ? 2.5 : 2} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">Task</span>
          </button>
          <button
            onClick={() => {
              if (currentTab === 'social' && viewingGroupId) {
                setViewingGroupId(null);
              } else {
                setCurrentTab('social');
              }
            }}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all ${
              currentTab === 'social' 
                ? (isNight ? 'text-matcha-400 scale-110' : 'text-matcha-600 scale-110') 
                : 'text-matcha-400/80 hover:text-matcha-600'
            }`}
          >
            <Users className={currentTab === 'social' ? (isNight ? "w-6 h-6 fill-matcha-400 text-matcha-400" : "w-6 h-6 fill-matcha-600 text-matcha-600") : "w-6 h-6"} strokeWidth={currentTab === 'social' ? 2.5 : 2} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">Group</span>
          </button>
        </nav>

        {/* Group Action Confirmation Modal */}
        <AnimatePresence>
          {confirmingGroupAction && (
            <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className={`p-8 rounded-[40px] w-full max-w-md space-y-8 border transition-all duration-500 ${
                  isNight 
                    ? 'glass-dark text-white shadow-3d-dark' 
                    : 'glass-light text-zinc-900 shadow-3d-light'
                }`}
              >
                <div className="flex flex-col items-center text-center gap-6">
                  <div className={`w-20 h-20 rounded-[32px] flex items-center justify-center ${
                    confirmingGroupAction.type === 'delete' ? 'bg-rose-50 text-rose-500' : 'bg-zinc-50 text-zinc-500'
                  }`}>
                    {confirmingGroupAction.type === 'delete' ? <Trash2 className="w-10 h-10" /> : <LogOut className="w-10 h-10" />}
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black uppercase tracking-tight">
                      {confirmingGroupAction.type === 'delete' ? 'Hapus Grup?' : 'Keluar dari Grup?'}
                    </h3>
                    <p className="text-sm text-zinc-400 font-medium leading-relaxed">
                      {confirmingGroupAction.type === 'delete' 
                        ? `Sebagai pemilik, keluar dari grup akan MENGHAPUS secara permanen "${groups.find(g => g.id === confirmingGroupAction.groupId)?.name}" beserta semua misi di dalamnya.`
                        : `Apakah Anda yakin ingin keluar dari grup "${groups.find(g => g.id === confirmingGroupAction.groupId)?.name}"?`
                      }
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    disabled={isGroupActionLoading}
                    onClick={() => leaveGroup(confirmingGroupAction.groupId)}
                    className={`w-full py-5 rounded-3xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3 ${
                      confirmingGroupAction.type === 'delete'
                        ? 'bg-rose-500 text-white shadow-rose-200'
                        : 'bg-zinc-900 text-white shadow-zinc-200'
                    } disabled:opacity-50`}
                  >
                    {isGroupActionLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      confirmingGroupAction.type === 'delete' ? 'Ya, Hapus Grup' : 'Ya, Keluar'
                    )}
                  </button>
                  <button
                    disabled={isGroupActionLoading}
                    onClick={() => setConfirmingGroupAction(null)}
                    className="w-full py-5 rounded-3xl text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-colors"
                  >
                    Batalkan
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {taskToDelete && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className={`p-8 rounded-[40px] w-full max-w-md space-y-8 border transition-all duration-500 ${
                  isNight 
                    ? 'glass-dark text-white shadow-3d-dark' 
                    : 'glass-light text-zinc-900 shadow-3d-light'
                }`}
              >
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-3xl bg-rose-50 text-rose-500 flex items-center justify-center">
                    <Trash2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-tight">
                      {taskToDelete.recurrenceId ? 'Misi Berulang' : 'Konfirmasi Hapus'}
                    </h3>
                    <p className="text-sm text-zinc-400 font-medium px-4 mt-2">
                      {taskToDelete.recurrenceId 
                        ? `Misi ini adalah bagian dari siklus ${taskToDelete.recurrence}. Bagaimana Anda ingin melanjutkan?`
                        : `Apakah Anda yakin ingin menghapus misi "${taskToDelete.title}"? Tindakan ini tidak dapat dibatalkan.`
                      }
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {taskToDelete.recurrenceId ? (
                    <>
                      <button
                        onClick={() => removeTask(taskToDelete.id, false)}
                        className="w-full py-5 rounded-[24px] bg-zinc-900 text-white font-black text-sm uppercase tracking-widest hover:bg-black transition-all"
                      >
                        Hapus Hanya Kali Ini
                      </button>
                      <button
                        onClick={() => removeTask(taskToDelete.id, true)}
                        className="w-full py-5 rounded-[24px] bg-rose-500 text-white font-black text-sm uppercase tracking-widest hover:bg-rose-600 transition-all"
                      >
                        Hapus Seluruh Seri
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => removeTask(taskToDelete.id, false)}
                      className="w-full py-5 rounded-[24px] bg-rose-500 text-white font-black text-sm uppercase tracking-widest hover:bg-rose-600 transition-all"
                    >
                      Ya, Hapus Misi
                    </button>
                  )}
                  <button
                    onClick={() => setTaskToDelete(null)}
                    className="w-full py-5 rounded-[24px] bg-white border border-zinc-100 text-zinc-400 font-black text-sm uppercase tracking-widest hover:text-black transition-all"
                  >
                    Batalkan
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Task Form Modal */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFormOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div 
               initial={{ scale: 0.9, opacity: 0, y: 40 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 40 }}
               className={`relative w-full max-w-lg p-6 sm:p-12 rounded-[32px] sm:rounded-[48px] max-h-[95vh] overflow-y-auto custom-scrollbar border transition-all duration-500 ${
                 isNight 
                   ? 'glass-dark text-white shadow-3d-dark' 
                   : 'glass-light text-zinc-900 shadow-3d-light'
               }`}
             >
               <h2 className="text-3xl sm:text-4xl font-display font-extrabold mb-6 sm:mb-10 tracking-tight uppercase text-center text-matcha-700">
                 {editingTaskId ? 'Edit Schedule' : 'New Schedule'}
               </h2>
              <form onSubmit={handleTaskSubmit} className="space-y-6 sm:space-y-10">
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Title</p>
                    <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${newTask.title.length > 25 ? 'text-rose-500' : 'opacity-20'}`}>
                      {newTask.title.length} / 25
                    </p>
                  </div>
                  <input 
                    required
                    autoFocus
                    maxLength={25}
                    placeholder="Apa yang akan Anda lakukan?"
                    className={`w-full text-lg sm:text-xl font-bold bg-transparent border-b-2 outline-none pb-3 transition-colors placeholder:opacity-30 ${
                      isNight 
                        ? 'border-white/10 text-white focus:border-white focus:placeholder:opacity-55' 
                        : 'border-zinc-200 text-zinc-900 focus:border-matcha-700 focus:placeholder:opacity-55'
                    }`}
                    value={newTask.title}
                    onChange={e => setNewTask({...newTask, title: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Explanation (Optional)</p>
                  <textarea 
                    placeholder="Tambahkan detail misi atau catatan di sini..."
                    className={`w-full min-h-[110px] p-4 rounded-xl border-2 font-sans font-medium text-sm sm:text-base outline-none transition-all resize-none ${
                      isNight 
                        ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-white' 
                        : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-400 focus:border-matcha-700'
                    }`}
                    value={newTask.description}
                    onChange={e => setNewTask({...newTask, description: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Launch Date</p>
                  <input 
                    required
                    type="date"
                    className={`w-full p-5 rounded-[24px] border-2 font-mono font-bold text-xl outline-none transition-all ${
                      isNight 
                        ? 'bg-white/5 border-white/10 text-white focus:border-white' 
                        : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 focus:border-zinc-950'
                    }`}
                    value={newTask.date}
                    onChange={e => setNewTask({...newTask, date: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Launch & Arrival Hours</p>
                  <TimeRangeSlider
                    startTime={newTask.startTime || "07:00"}
                    endTime={newTask.endTime || "17:00"}
                    onChange={(start, end) => {
                      setNewTask({
                        ...newTask,
                        startTime: start,
                        endTime: end
                      });
                    }}
                    isNight={isNight}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Repeat Cycle</p>
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300 italic">Optional</span>
                  </div>
                  <div className="flex gap-2">
                    {(['none', 'weekly', 'monthly'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setNewTask({...newTask, recurrence: type})}
                        className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          newTask.recurrence === type 
                            ? isNight
                              ? 'bg-white text-zinc-950 border-white shadow-lg scale-105'
                              : 'bg-black text-white border-black shadow-lg scale-105' 
                            : isNight
                              ? 'bg-white/5 text-zinc-400 border-white/5 hover:border-white/10 hover:bg-white/10'
                              : 'bg-zinc-100/65 text-zinc-700 border-zinc-200/80 hover:border-zinc-350 hover:bg-zinc-100'
                        }`}
                      >
                        {type === 'none' ? 'Once' : type}
                      </button>
                    ))}
                  </div>
                  {newTask.recurrence !== 'none' && (
                    <p className="text-[8px] font-black uppercase tracking-widest text-center opacity-30 animate-pulse">
                      Initializing 12 successive cycles in your fleet log
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Aura Identifier</p>
                  <div className="flex justify-between gap-2">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewTask({...newTask, color})}
                        className="w-12 h-12 rounded-2xl transition-all hover:scale-110 active:scale-90 flex items-center justify-center relative overflow-hidden"
                        style={{ backgroundColor: color }}
                      >
                        {newTask.color === color && (
                          <div className="absolute inset-0 bg-white/20 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-5 rounded-[24px] bg-gradient-to-r from-matcha-600 to-matcha-800 text-white font-display font-black text-lg shadow-xl shadow-matcha-900/20 hover:shadow-matcha-600/30 transform transition-all active:scale-[0.98]"
                >
                  {editingTaskId ? 'UPDATE SCHEDULE' : 'INITIALIZE'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Assignment Form Modal */}
      <AnimatePresence>
        {isAssignmentFormOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAssignmentFormOpen(false)}
              className="absolute inset-0 bg-blue-900/40 backdrop-blur-xl"
            />
             <motion.div 
               initial={{ scale: 0.9, opacity: 0, y: 40 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 40 }}
               className={`relative w-full max-w-2xl p-6 sm:p-12 rounded-[48px] max-h-[90vh] overflow-y-auto no-scrollbar border transition-all duration-500 ${
                 isNight 
                   ? 'glass-dark text-white shadow-3d-dark' 
                   : 'glass-light text-zinc-900 shadow-3d-light'
               }`}
             >
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight uppercase text-blue-600">
                  {editingTaskId ? 'Edit Assignment' : 'New Assignment'}
                </h2>
                <button 
                  type="button"
                  onClick={() => setIsAssignmentFormOpen(false)}
                  className="w-12 h-12 rounded-full bg-white/40 border border-white/60 hover:bg-white/80 active:scale-95 flex items-center justify-center text-zinc-600 hover:text-black transition-all shadow-sm transform hover:rotate-90"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAssignmentSubmit} className="space-y-8">
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">DAFTAR TUGAS</p>
                  <div className="relative">
                    <input 
                      required
                      list="schedule-subjects"
                      placeholder="Nama tugas atau mata kuliah..."
                      className={`w-full text-lg sm:text-xl font-bold bg-transparent border-b-2 outline-none pb-3 transition-colors placeholder:opacity-30 ${
                        isNight 
                          ? 'border-white/10 text-white focus:border-blue-500 focus:placeholder:opacity-55' 
                          : 'border-zinc-200 text-zinc-900 focus:border-blue-600 focus:placeholder:opacity-55'
                      }`}
                      value={newAssignment.title}
                      onChange={e => setNewAssignment({...newAssignment, title: e.target.value})}
                    />
                    <datalist id="schedule-subjects">
                      {scheduleSuggestions.map((subject, idx) => (
                        <option key={`suggestion-${subject}-${idx}`} value={subject} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">DEADLINE</p>
                    <input 
                      required
                      type="date"
                      className={`w-full p-5 rounded-[24px] border-2 font-mono font-bold text-xl outline-none transition-all ${
                        isNight 
                          ? 'bg-white/5 border-white/10 text-white focus:border-blue-500' 
                          : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 focus:border-blue-600'
                      }`}
                      value={newAssignment.date}
                      onChange={e => setNewAssignment({...newAssignment, date: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">KETERANGAN</p>
                    <select
                      className={`w-full p-4 px-6 rounded-[24px] border-2 font-mono font-bold text-lg outline-none transition-all ${
                        isNight
                          ? newAssignment.category === 'Individu' ? 'bg-amber-950/40 border-amber-900/50 text-amber-300' : 
                            newAssignment.category === 'Kelompok' ? 'bg-blue-950/40 border-blue-900/50 text-blue-300' : 
                            'bg-white/5 border-white/10 text-white focus:border-blue-500'
                          : newAssignment.category === 'Individu' ? 'bg-amber-50 border-amber-200 text-amber-700' : 
                            newAssignment.category === 'Kelompok' ? 'bg-blue-50 border-blue-200 text-blue-700' : 
                            'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 focus:border-blue-600'
                      }`}
                      value={newAssignment.category}
                      onChange={e => setNewAssignment({...newAssignment, category: e.target.value as any})}
                    >
                      <option className="text-zinc-900 bg-white" value="Individu">INDIVIDU</option>
                      <option className="text-zinc-900 bg-white" value="Kelompok">KELOMPOK</option>
                      <option className="text-zinc-900 bg-white" value="Lainnya">LAINNYA</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">PENJELASAN TUGAS</p>
                  <textarea 
                    placeholder="Tulis detail instruksi tugas di sini..."
                    className={`w-full min-h-[110px] p-4 rounded-xl border-2 font-sans font-medium text-sm sm:text-base outline-none transition-all resize-none ${
                      isNight 
                        ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-blue-500' 
                        : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600'
                    }`}
                    value={newAssignment.description}
                    onChange={e => setNewAssignment({...newAssignment, description: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">LINK TUGAS</p>
                    <input 
                      type="url"
                      placeholder="HTTPS://..."
                      className={`w-full p-5 rounded-[24px] border-2 font-mono font-bold text-lg outline-none transition-all ${
                        isNight 
                          ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-blue-500' 
                          : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-450 focus:border-blue-600'
                      }`}
                      value={newAssignment.taskLink}
                      onChange={e => setNewAssignment({...newAssignment, taskLink: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">LINK PENGUMPULAN</p>
                    <input 
                      type="url"
                      placeholder="HTTPS://..."
                      className={`w-full p-5 rounded-[24px] border-2 font-mono font-bold text-lg outline-none transition-all ${
                        isNight 
                          ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-blue-500' 
                          : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-450 focus:border-blue-600'
                      }`}
                      value={newAssignment.submissionLink}
                      onChange={e => setNewAssignment({...newAssignment, submissionLink: e.target.value})}
                    />
                  </div>
                </div>

                <div className="pt-10 flex gap-4">
                  <button 
                    type="submit"
                    className="flex-1 py-8 bg-blue-600 text-white rounded-[32px] text-xs font-black uppercase tracking-[0.3em] hover:scale-[1.02] active:scale-95 transition-all shadow-2xl shadow-blue-200"
                  >
                    {editingTaskId ? 'Update Assignment' : 'Save Assignment'}
                  </button>
                  {editingTaskId && (
                    <button 
                      type="button"
                      onClick={() => {
                        const taskToDel = tasks.find(t => t.id === editingTaskId);
                        if (!taskToDel) return;
                        if (taskToDel.recurrenceId) {
                          setTaskToDelete(taskToDel);
                          setIsAssignmentFormOpen(false);
                        } else if (window.confirm(`Hapus "${taskToDel.title}" permanen?`)) {
                          removeTask(editingTaskId);
                          setIsAssignmentFormOpen(false);
                        }
                      }}
                      className="w-24 rounded-[32px] bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shadow-xl shadow-rose-100"
                    >
                      <Trash2 className="w-8 h-8" />
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full Calendar Modal */}
      <AnimatePresence>
        {showFullCalendar && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className={`w-full max-w-md rounded-[32px] sm:rounded-[48px] overflow-hidden p-4 sm:p-8 border transition-all duration-500 ${
                 isNight 
                   ? 'glass-dark text-white shadow-3d-dark' 
                   : 'glass-light text-zinc-900 shadow-3d-light'
               }`}
            >
              <div className="flex items-center justify-between mb-6 sm:mb-8">
                <button 
                  onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1))}
                  className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="text-center">
                  <h2 className="text-2xl font-black italic uppercase tracking-tighter">
                    {monthNames[viewDate.getMonth()]}
                  </h2>
                  <p className="text-[10px] font-black opacity-30">{viewDate.getFullYear()}</p>
                </div>
                <button 
                  onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1))}
                  className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-4">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={`${d}-${i}`} className="text-center text-[10px] font-black opacity-20 py-2">{d}</div>
                ))}
                
                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}

                {calendarDays.map((date, i) => {
                  const isSelected = date.toDateString() === selectedDate.toDateString();
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isHolidayDay = isHoliday(date);
                  const dateKey = formatDate(date);
                  const hasTasks = tasks.some(t => t.date === dateKey);

                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedDate(date);
                        setShowFullCalendar(false);
                      }}
                      className={`aspect-square flex flex-col items-center justify-center rounded-xl sm:rounded-2xl relative transition-all active:scale-90 ${
                        isSelected ? 'bg-black text-white shadow-lg scale-110 z-10' : 'hover:bg-zinc-100'
                      }`}
                    >
                      <span className={`text-xs sm:text-sm font-black ${
                        isSelected ? 'text-white' : (isHolidayDay ? 'text-rose-600' : (isToday ? 'text-blue-600' : ''))
                      }`}>
                        {date.getDate()}
                      </span>
                      {hasTasks && !isSelected && (
                        <div className="absolute bottom-2 w-1 h-1 rounded-full bg-zinc-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              <button 
                onClick={() => setShowFullCalendar(false)}
                className="w-full py-5 rounded-[24px] bg-zinc-100 font-black text-sm uppercase tracking-widest mt-4 hover:bg-zinc-200 transition-colors"
              >
                CLOSE SCHEDULE LOG
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedTaskDetails && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTaskId(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
             <motion.div 
               initial={{ scale: 0.9, opacity: 0, y: 40 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 40 }}
               className={`relative w-full max-w-lg p-6 sm:p-10 rounded-[32px] sm:rounded-[48px] border overflow-y-auto max-h-[95vh] custom-scrollbar transition-all duration-500 ${
                 isNight 
                   ? 'glass-dark text-white shadow-3d-dark' 
                   : 'glass-light text-zinc-900 shadow-3d-light'
               }`}
               style={{ borderLeftColor: selectedTaskDetails.color, borderLeftWidth: '16px' }}
            >
              <button 
                onClick={() => setSelectedTaskId(null)}
                className="absolute top-4 right-4 sm:top-8 sm:right-8 p-2 hover:bg-white/40 rounded-full transition-colors z-10 text-zinc-500 hover:text-zinc-900 w-10 h-10 flex items-center justify-center"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex flex-col gap-6 sm:gap-8">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <p className="text-[10px] font-display font-black uppercase tracking-[0.35em] text-matcha-700 opacity-90">
                      {selectedTaskDetails.isSchedule ? 'Jadwal Grup' : 'Detailed Schedule'}
                    </p>
                    {selectedTaskDetails.isSchedule ? (
                      <span className="px-2 py-0.5 rounded-full bg-matcha-600 text-white text-[8px] font-display font-black uppercase tracking-widest">
                        {selectedTaskDetails.groupName}
                      </span>
                    ) : selectedTaskDetails.ownerUid === user?.uid ? (
                      <span className="px-2 py-0.5 rounded-full bg-matcha-800 text-white text-[8px] font-display font-black uppercase tracking-widest">
                        Your Schedule
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-[8px] font-display font-black uppercase tracking-widest">
                        Shared Schedule
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl sm:text-4xl font-display font-black tracking-tight uppercase leading-tight text-matcha-900">
                    {selectedTaskDetails.title}
                  </h2>
                </div>

                <div className="flex flex-wrap gap-4 sm:gap-10">
                  {(() => {
                    const detailDeadline = new Date(selectedTaskDetails.date);
                    const nowToday = new Date();
                    nowToday.setHours(0, 0, 0, 0);
                    const actualDiffDays = Math.ceil((detailDeadline.getTime() - nowToday.getTime()) / (1000 * 60 * 60 * 24));
                    const detailIsCompleted = selectedTaskDetails.status === 'Sudah Dikumpul';

                    const getDetailUrgencyColor = () => {
                      if (detailIsCompleted) return 'text-emerald-600';
                      if (actualDiffDays < 0) return 'text-rose-600';
                      if (actualDiffDays === 0) return 'text-rose-500 animate-bounce';
                      if (actualDiffDays === 1) return 'text-rose-400 font-bold';
                      if (actualDiffDays === 2) return 'text-orange-500';
                      if (actualDiffDays === 3) return 'text-amber-500';
                      return 'text-blue-500';
                    };

                    const detailSisaLabel = actualDiffDays === 0 ? 'HARI INI' : (actualDiffDays > 0 ? `${actualDiffDays} HARI LAGI` : `${Math.abs(actualDiffDays)} HARI TELAT`);

                    return (
                      <>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-display font-black uppercase tracking-[0.2em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Launch</p>
                          <p className="font-mono font-black text-xl">{selectedTaskDetails.startTime}</p>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-display font-black uppercase tracking-[0.2em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Arrival</p>
                          <p className="font-mono font-black text-xl">{selectedTaskDetails.endTime}</p>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-display font-black uppercase tracking-[0.2em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Date</p>
                          <p className="font-mono font-black text-xl">{selectedTaskDetails.date}</p>
                        </div>
                        <div className="space-y-1">
                          <p className={`text-[10px] font-display font-black uppercase tracking-[0.2em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Sisa Waktu</p>
                          <p className={`font-mono font-black text-xl italic ${getDetailUrgencyColor()}`}>
                            {detailIsCompleted ? 'SELESAI' : detailSisaLabel}
                          </p>
                        </div>
                      </>
                    );
                  })()}
                  {selectedTaskDetails.type === 'assignment' && (
                    <div className="space-y-1">
                      <p className={`text-[10px] font-display font-black uppercase tracking-[0.2em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Keterangan</p>
                      <span className={`px-3 py-1 rounded-xl text-[10px] font-display font-black uppercase tracking-[0.1em] block ${
                        selectedTaskDetails.category === 'Individu' ? 'bg-amber-100/75 text-amber-800 border border-amber-200/50' : 
                        selectedTaskDetails.category === 'Kelompok' ? 'bg-blue-100/75 text-blue-800 border border-blue-200/50' : 
                        'bg-zinc-100/75 text-zinc-600 border border-zinc-200/50'
                      }`}>
                        {selectedTaskDetails.category || 'Individu'}
                      </span>
                    </div>
                  )}
                </div>

                {selectedTaskDetails.isSchedule ? (
                  <div className={`grid grid-cols-2 gap-4 p-8 rounded-[32px] border ${
                    isNight ? 'bg-zinc-950/25 border-white/5 shadow-2xl' : 'bg-white/40 border-white/20 backdrop-blur-md shadow-sm'
                  }`}>
                    <div className="space-y-1">
                      <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Dosen Pengampu</p>
                      <p className={`font-semibold text-sm ${isNight ? 'text-zinc-200' : 'text-zinc-805'}`}>
                        {selectedTaskDetails.lecturers?.join(', ') || '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Modality</p>
                      <span className={`px-2 py-1 rounded-lg text-[9px] font-display font-black uppercase tracking-widest inline-block ${
                        selectedTaskDetails.modality === 'Online' ? 'bg-blue-105 text-blue-805 shadow-sm' : 'bg-emerald-105 text-emerald-805 shadow-sm'
                      }`}>
                        {selectedTaskDetails.modality || 'Offline'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Bobot SKS</p>
                      <p className={`font-mono font-black text-sm ${isNight ? 'text-zinc-200' : 'text-zinc-805'}`}>{selectedTaskDetails.sks || '0'} SKS</p>
                    </div>
                    <div className="space-y-1">
                      <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Durasi</p>
                      <p className={`font-mono font-black text-sm ${isNight ? 'text-zinc-200' : 'text-zinc-805'}`}>{selectedTaskDetails.duration || '-'}</p>
                    </div>
                  </div>
                ) : selectedTaskDetails.description && (
                  <div className={`p-8 rounded-[32px] border ${
                    isNight ? 'bg-zinc-950/25 border-white/5 shadow-2xl' : 'bg-white/40 border-white/20 backdrop-blur-md shadow-sm'
                  }`}>
                    <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-matcha-300' : 'text-matcha-700'} mb-4`}>Explanation</p>
                    <p className={`font-medium leading-relaxed whitespace-pre-wrap break-words ${isNight ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      {selectedTaskDetails.description}
                    </p>
                  </div>
                )}

                {selectedTaskDetails.myNote && (
                  <div className={`p-8 rounded-[32px] border ${
                    isNight ? 'bg-blue-950/20 border-blue-900/40' : 'bg-blue-50/40 border-blue-100/60 backdrop-blur-md shadow-sm'
                  }`}>
                    <p className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${isNight ? 'text-blue-300' : 'text-blue-600'} mb-4`}>Tugas Saya / My Note</p>
                    <div className={`font-semibold leading-relaxed whitespace-pre-wrap break-all ${isNight ? 'text-zinc-200' : 'text-zinc-800'}`}>
                      {selectedTaskDetails.myNote.startsWith('http://') || selectedTaskDetails.myNote.startsWith('https://') ? (
                        <a 
                          href={selectedTaskDetails.myNote}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline hover:text-blue-750 transition-colors break-all"
                        >
                          {selectedTaskDetails.myNote}
                        </a>
                      ) : (
                        selectedTaskDetails.myNote
                      )}
                    </div>
                  </div>
                )}

                <div className={`p-6 rounded-[24px] border flex flex-col gap-3 ${
                  isNight ? 'bg-zinc-950/20 border-white/5' : 'bg-white/40 border-white/20 backdrop-blur-md shadow-sm'
                }`}>
                  <div className="flex items-center justify-between text-[10px] font-display font-bold uppercase tracking-widest">
                    <span className={`opacity-60 italic font-black ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Established By</span>
                    <span className={`${selectedTaskDetails.ownerUid === user?.uid ? 'text-blue-600 font-black' : isNight ? 'text-white' : 'text-zinc-900'} px-2 py-1 ${isNight ? 'bg-white/5 border-white/10' : 'bg-white/60 border-white/40'} rounded-lg shadow-sm border italic`}>
                      {getPilotDisplay(selectedTaskDetails)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-display font-bold uppercase tracking-widest">
                    <span className={`opacity-60 italic font-black ${isNight ? 'text-matcha-300' : 'text-matcha-700'}`}>Schedule Logged</span>
                    <span className={`${isNight ? 'text-zinc-300' : 'text-zinc-500'} font-mono italic`}>
                      {selectedTaskDetails.createdAt?.toDate ? selectedTaskDetails.createdAt.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending...'}
                    </span>
                  </div>
                  {selectedTaskDetails.updatedAt && (
                    <div className="flex items-center justify-between text-[10px] font-display font-bold uppercase tracking-widest text-blue-500">
                      <span className="opacity-65 italic font-black">Last Telemetry Update</span>
                      <span className="font-mono italic">
                        {selectedTaskDetails.updatedAt?.toDate ? selectedTaskDetails.updatedAt.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Hide / Show clock-face wedge toggle */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      toggleTaskVisibility(selectedTaskDetails.id);
                    }}
                    className={`w-full py-4 rounded-[20px] font-display font-black text-xs uppercase tracking-widest transition-all shadow-md active:scale-[0.98] hover:-translate-y-0.5 flex items-center justify-center gap-3 border cursor-pointer ${
                      hiddenTaskIds.has(selectedTaskDetails.id)
                        ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 shadow-amber-500/20'
                        : isNight
                          ? 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                          : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border-zinc-200/80'
                    }`}
                  >
                    {hiddenTaskIds.has(selectedTaskDetails.id) ? (
                      <>
                        <Eye className="w-4 h-4 stroke-[2.5]" />
                        TAMPILKAN DI JAM / SHOW ON CLOCK
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4 stroke-[2.5]" />
                        SEMBUNYIKAN DARI JAM / HIDE ON CLOCK
                      </>
                    )}
                  </button>
                </div>

                <div className="flex gap-4">
                  {!canEditTask(selectedTaskDetails) ? (
                    <div className="flex-1 p-4 rounded-[24px] bg-blue-50 border border-blue-100 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 italic">
                        Viewing Shared Telemetry — Modification Restricted
                      </p>
                    </div>
                  ) : (
                    <>
                      <button 
                        onClick={() => {
                          if (selectedTaskDetails.isSchedule) {
                            openScheduleEditor(selectedTaskDetails, selectedTaskDetails.originalIndex);
                          } else if (selectedTaskDetails.type === 'assignment') {
                            openAssignmentForm(selectedTaskDetails);
                          } else {
                            openForm(selectedTaskDetails);
                          }
                          setSelectedTaskId(null);
                        }}
                        className="flex-1 py-4 bg-zinc-100 text-zinc-900 rounded-[20px] font-black text-[10px] uppercase tracking-widest hover:bg-zinc-900 hover:text-white transition-all shadow-sm flex items-center justify-center gap-2"
                      >
                        <Edit2 className="w-4 h-4" />
                        {selectedTaskDetails.isSchedule ? 'Edit Schedule' : 'Edit Schedule'}
                      </button>
                      {canDeleteTask(selectedTaskDetails) && (
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!selectedTaskDetails) return;
                            
                            if (selectedTaskDetails.isSchedule) {
                              // Perform direct, reliable schedule item deletion
                              await removeScheduleItem(selectedTaskDetails.groupId, selectedTaskDetails, selectedTaskDetails.originalIndex);
                            } else {
                              await removeTask(selectedTaskDetails.id);
                            }
                            setSelectedTaskId(null);
                          }}
                          className="flex-1 py-4 bg-rose-50 text-rose-600 rounded-[20px] font-black text-[10px] uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-sm flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          {selectedTaskDetails.isSchedule ? 'Hapus dari Jadwal' : 'Hapus Schedule'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAllTasks && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAllTasks(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className={`relative w-full max-w-2xl rounded-[40px] p-6 sm:p-10 flex flex-col max-h-[90vh] overflow-hidden border transition-all duration-500 ${
                isNight 
                  ? 'glass-dark text-white shadow-3d-dark' 
                  : 'glass-light text-zinc-900 shadow-3d-light'
              }`}
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-lg">
                    <CalendarIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black uppercase tracking-tight italic">Schedule Archive</h3>
                    <p className="text-[10px] font-black opacity-30 mt-1 uppercase tracking-widest">Global Chronological Log ({tasks.length} Schedules)</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAllTasks(false)}
                  className="p-3 bg-zinc-50 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                {tasks.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CalendarIcon className="w-10 h-10 text-zinc-200" />
                    </div>
                    <p className="text-lg font-black text-zinc-300 italic uppercase">Your loop is empty</p>
                  </div>
                ) : (
                  Object.entries(
                    tasks.reduce((acc, t) => {
                      const date = t.date;
                      if (!acc[date]) acc[date] = [];
                      acc[date].push(t);
                      return acc;
                    }, {} as Record<string, Task[]>)
                  )
                  .sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime())
                  .map(([date, dayTasks]) => (
                    <div key={date} className="space-y-3">
                      <h4 className="sticky top-0 bg-white/80 backdrop-blur-sm py-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 z-10 flex items-center gap-3">
                        <span className="w-8 h-px bg-zinc-100" />
                        {new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4">
                        {(dayTasks as Task[])
                          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
                          .map(task => (
                          <div 
                            key={task.id}
                            onClick={() => {
                              const [y, m, d] = task.date.split('-').map(Number);
                              setSelectedDate(new Date(y, m-1, d));
                              setSelectedTaskId(task.id);
                              setShowAllTasks(false);
                            }}
                            className="p-4 rounded-3xl border border-zinc-100 bg-zinc-50 hover:bg-white hover:shadow-xl transition-all group cursor-pointer flex items-center gap-4"
                          >
                            <div className="w-2 h-10 rounded-full" style={{ backgroundColor: task.color }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-black uppercase tracking-tight text-zinc-800 truncate">{task.title}</p>
                                {task.ownerUid === user?.uid ? (
                                  <span className="px-1.5 py-0.5 rounded bg-black text-white text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
                                    Captain
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
                                    Co-Pilot
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                <p className="text-[10px] font-mono font-bold opacity-40 flex items-center gap-1.5">
                                  <Clock className="w-3 h-3" /> {task.startTime} — {task.endTime}
                                </p>
                              </div>
                            </div>
                            {/* Actions moved to task details popup */}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-zinc-50">
                <button 
                  onClick={() => setShowAllTasks(false)}
                  className="w-full py-5 rounded-[24px] bg-black text-white font-black text-xs uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-lg"
                >
                  Return to Dashboard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isScheduleModalOpen && editingScheduleItem && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsScheduleModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={`relative w-full max-w-lg rounded-[48px] p-10 flex flex-col gap-8 max-h-[90vh] overflow-y-auto custom-scrollbar border transition-all duration-500 ${
                isNight 
                  ? 'glass-dark text-white shadow-3d-dark' 
                  : 'glass-light text-zinc-900 shadow-3d-light'
              }`}
            >
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-40">Schedule Matrix</p>
                <h3 className="text-3xl font-black uppercase tracking-tight italic">Ops Entry Editor</h3>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Subject Hari</label>
                      <select 
                        value={editingScheduleItem.day}
                        onChange={(e) => setEditingScheduleItem({...editingScheduleItem, day: e.target.value})}
                        className={`w-full px-6 py-4 rounded-2xl border font-bold text-sm uppercase tracking-widest outline-none transition-all ${
                          isNight 
                            ? 'bg-white/5 border-white/10 text-white' 
                            : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900'
                        }`}
                      >
                         {['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'].map(d => (
                            <option key={d} className="text-zinc-900 bg-white" value={d}>{d}</option>
                         ))}
                      </select>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Modality</label>
                      <select 
                        value={editingScheduleItem.modality}
                        onChange={(e) => setEditingScheduleItem({...editingScheduleItem, modality: e.target.value as any})}
                        className={`w-full px-6 py-4 rounded-2xl border font-bold text-sm uppercase tracking-widest outline-none transition-all ${
                          isNight 
                            ? 'bg-white/5 border-white/10 text-white' 
                            : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900'
                        }`}
                      >
                         <option className="text-zinc-900 bg-white" value="Online">Online</option>
                         <option className="text-zinc-900 bg-white" value="Offline">Offline</option>
                      </select>
                   </div>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Subject / Mata Kuliah</label>
                   <input 
                     type="text"
                     value={editingScheduleItem.subject}
                     onChange={(e) => setEditingScheduleItem({...editingScheduleItem, subject: e.target.value.toUpperCase()})}
                     placeholder="ENTER SUBJECT"
                     className={`w-full px-6 py-4 rounded-2xl border font-black text-sm uppercase tracking-tight outline-none transition-all ${
                       isNight 
                         ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-600 focus:border-white' 
                         : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-455 focus:border-zinc-950'
                     }`}
                   />
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Alokasi Jam Belajar</label>
                   <TimeRangeSlider isNight={isNight}
                     startTime={editingScheduleItem.startTime || "07:00"}
                     endTime={editingScheduleItem.endTime || "17:00"}
                     onChange={(start, end) => {
                       setEditingScheduleItem({
                         ...editingScheduleItem,
                         startTime: start,
                         endTime: end,
                         duration: calculateDuration(start, end)
                       });
                     }}
                   />
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Lecturers (One per line)</label>
                   <textarea 
                     value={editingScheduleItem.lecturers.join('\n')}
                     onChange={(e) => setEditingScheduleItem({...editingScheduleItem, lecturers: e.target.value.split('\n')})}
                     rows={3}
                     placeholder="1. Name Here..."
                     className={`w-full px-6 py-4 rounded-2xl border font-bold text-xs uppercase outline-none transition-all resize-none ${
                       isNight 
                         ? 'bg-white/5 border-white/10 text-white placeholder:text-zinc-600 focus:border-white' 
                         : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 placeholder:text-zinc-455 focus:border-zinc-950'
                     }`}
                   />
                </div>

                <div className="grid grid-cols-1 gap-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">SKS</label>
                      <input 
                        type="number"
                        value={editingScheduleItem.sks}
                        onChange={(e) => setEditingScheduleItem({...editingScheduleItem, sks: parseInt(e.target.value) || 0})}
                        className={`w-full px-6 py-4 rounded-2xl border font-bold text-sm outline-none transition-all ${
                          isNight 
                            ? 'bg-white/5 border-white/10 text-white focus:border-white' 
                            : 'bg-zinc-100/60 border-zinc-200/80 text-zinc-900 focus:border-zinc-950'
                        }`}
                      />
                   </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                 <button 
                   onClick={async () => {
                     if (!viewingGroupId) return;
                     const group = groups.find(g => g.id === viewingGroupId);
                     if (!group) return;

                     const currentSchedule = [...(group.schedule || DEFAULT_SCHEDULE)];
                     const { originalIndex, ...itemData } = editingScheduleItem;
                     const itemToSave = {
                       ...itemData,
                       id: editingScheduleItem.id || `sched_${Date.now()}_` + Math.random().toString(36).substring(2, 10)
                     } as GroupScheduleItem;
                     
                     if (editingScheduleIdx !== null) {
                       currentSchedule[editingScheduleIdx] = itemToSave;
                     } else {
                       currentSchedule.push(itemToSave);
                     }

                     try {
                       await updateDoc(doc(db, 'groups', viewingGroupId), { 
                         schedule: currentSchedule,
                         updatedAt: serverTimestamp()
                       });
                       setIsScheduleModalOpen(false);
                     } catch (err) {
                       handleFirestoreError(err, OperationType.UPDATE, `groups/${viewingGroupId}`);
                     }
                   }}
                   className="w-full py-5 rounded-[24px] bg-zinc-900 text-white font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-zinc-200"
                 >
                   Simpan Perubahan
                 </button>
                 {editingScheduleIdx !== null && (
                    <button 
                      onClick={async () => {
                        if (viewingGroupId && editingScheduleItem) {
                          if (window.confirm(`Hapus "${editingScheduleItem.subject}" dari jadwal grup?`)) {
                            await removeScheduleItem(viewingGroupId, editingScheduleItem, editingScheduleIdx);
                            setIsScheduleModalOpen(false);
                          }
                        }
                      }}
                     className="w-full py-5 rounded-[24px] bg-rose-50 text-rose-600 font-black text-sm uppercase tracking-widest hover:bg-rose-100 transition-all border border-rose-200"
                   >
                     Hapus dari Jadwal
                   </button>
                 )}
                 <button 
                   onClick={() => setIsScheduleModalOpen(false)}
                   className="w-full py-5 rounded-[24px] bg-white border border-zinc-100 text-zinc-400 font-black text-sm uppercase tracking-widest hover:text-black transition-all"
                 >
                   Discard Changes
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .perspective-1000 { perspective: 1000px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { display: none; }
        .custom-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
