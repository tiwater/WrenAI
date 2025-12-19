import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ProjectContextType {
  selectedProjectId: number | null;
  setSelectedProjectId: (projectId: number | null) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const PROJECT_STORAGE_KEY = 'wrenai_selected_project';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProjectId, setSelectedProjectIdState] = useState<number | null>(null);

  // Load selected project from localStorage on mount
  useEffect(() => {
    const storedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (storedProjectId) {
      setSelectedProjectIdState(parseInt(storedProjectId, 10));
    }
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
    <ProjectContext.Provider value={{ selectedProjectId, setSelectedProjectId }}>
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
  const { selectedProjectId } = useProject();
  
  if (!selectedProjectId) {
    throw new Error('No project selected. Please select a project first.');
  }
  
  return selectedProjectId;
}

// Optional hook that returns null instead of throwing when no project selected
export function useOptionalSelectedProject() {
  const { selectedProjectId } = useProject();
  return selectedProjectId;
}