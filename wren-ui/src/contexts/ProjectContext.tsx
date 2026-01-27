import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';

interface ProjectContextType {
  selectedProjectId: number | null;
  setSelectedProjectId: (projectId: number | null) => void;
  hydrated: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const PROJECT_STORAGE_KEY = 'wrenai_selected_project';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProjectId, setSelectedProjectIdState] = useState<
    number | null
  >(null);
  const [hydrated, setHydrated] = useState(false);

  // Load selected project from localStorage on mount
  useEffect(() => {
    const queryProjectId = (() => {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('projectId');
        if (!raw) return null;
        const pid = Number(raw);
        return Number.isFinite(pid) ? pid : null;
      } catch {
        return null;
      }
    })();

    if (queryProjectId) {
      setSelectedProjectIdState(queryProjectId);
      localStorage.setItem(PROJECT_STORAGE_KEY, queryProjectId.toString());
      setHydrated(true);
      return;
    }

    const storedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (storedProjectId) {
      setSelectedProjectIdState(parseInt(storedProjectId, 10));
    }
    setHydrated(true);
  }, []);

  // Save selected project to localStorage when it changes
  const setSelectedProjectId = (projectId: number | null) => {
    setSelectedProjectIdState(projectId);
    if (projectId !== null) {
      localStorage.setItem(PROJECT_STORAGE_KEY, projectId.toString());
    } else {
      localStorage.removeItem(PROJECT_STORAGE_KEY);
    }
  };

  return (
    <ProjectContext.Provider
      value={{ selectedProjectId, setSelectedProjectId, hydrated }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

// Hook to ensure a project is selected
export function useSelectedProject() {
  const { selectedProjectId, hydrated } = useProject();

  // Avoid throwing during SSR. On the server, localStorage/sessionStorage is not
  // available and selectedProjectId will be null until hydration.
  if (typeof window === 'undefined') {
    return selectedProjectId || 0;
  }

  // Avoid throwing during initial client render before hydration completes.
  if (!hydrated) {
    return selectedProjectId || 0;
  }

  // Check if we are in a state where missing selectedProjectId is expected
  const isSetupFlow =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/setup') ||
      window.location.pathname.startsWith('/embed') ||
      sessionStorage.getItem('creatingNewProject') === 'true' ||
      window.location.pathname === '/projects');

  if (!selectedProjectId && !isSetupFlow) {
    throw new Error('No project selected. Please select a project first.');
  }

  return selectedProjectId;
}

// Optional hook that returns null instead of throwing when no project selected
export function useOptionalSelectedProject() {
  const { selectedProjectId } = useProject();
  return selectedProjectId;
}
