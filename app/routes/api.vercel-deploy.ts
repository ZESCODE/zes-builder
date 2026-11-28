import { withSecurity } from '~/lib/security';
import type { VercelProjectInfo } from '~/types/vercel';

const ZES_OWNED_PROJECT_IDS = new Set(['prj_w2rAtbukOEw7tU35XYWW1KpZgQAa']);
const MAX_DEPLOYMENT_FILES = 200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 5_000_000;

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get('Authorization');

  if (header?.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function clientExposedCredentialError(): string | undefined {
  return process.env.VITE_VERCEL_ACCESS_TOKEN
    ? 'a VITE_-prefixed Vercel credential is present in the server environment; remove it before using this endpoint'
    : undefined;
}

function isZesOwnedProject(projectId: string | undefined): boolean {
  return projectId ? ZES_OWNED_PROJECT_IDS.has(projectId) : false;
}

function normalizeDeploymentPath(filePath: string): string | null {
  const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;

  if (!normalized || normalized.includes('..')) {
    return null;
  }

  return normalized;
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content ?? '').length;
}

async function readProject(token: string, projectId: string) {
  const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return undefined;
  }

  return (await response.json()) as {
    id: string;
    name: string;
    account?: { id?: string; name?: string };
  };
}

async function tokenBelongsToProjectAccount(token: string, projectAccountId?: string): Promise<boolean> {
  if (!projectAccountId) {
    return true;
  }

  const response = await fetch('https://api.vercel.com/v2/user', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return true;
  }

  const payload = (await response.json()) as { user?: { id?: string } };
  const userId = payload.user?.id;

  return !userId || userId === projectAccountId;
}

// Function to detect framework from project files
const detectFramework = (files: Record<string, string>): string => {
  // Check for package.json first
  const packageJson = files['package.json'];

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for specific frameworks
      if (dependencies.next) {
        return 'nextjs';
      }

      if (dependencies.react && dependencies['react-router']) {
        return 'remix';
      }

      if (dependencies.react && dependencies.vite) {
        return 'vite';
      }

      if (dependencies.react && dependencies['@vitejs/plugin-react']) {
        return 'vite';
      }

      if (dependencies.react && dependencies['@nuxt/react']) {
        return 'nuxt';
      }

      if (dependencies.react && dependencies['@qwik-city/qwik']) {
        return 'qwik';
      }

      if (dependencies.react && dependencies['@sveltejs/kit']) {
        return 'sveltekit';
      }

      if (dependencies.react && dependencies.astro) {
        return 'astro';
      }

      if (dependencies.react && dependencies['@angular/core']) {
        return 'angular';
      }

      if (dependencies.react && dependencies.vue) {
        return 'vue';
      }

      if (dependencies.react && dependencies['@expo/react-native']) {
        return 'expo';
      }

      if (dependencies.react && dependencies['react-native']) {
        return 'react-native';
      }

      // Generic React app
      if (dependencies.react) {
        return 'react';
      }

      // Check for other frameworks
      if (dependencies['@angular/core']) {
        return 'angular';
      }

      if (dependencies.vue) {
        return 'vue';
      }

      if (dependencies['@sveltejs/kit']) {
        return 'sveltekit';
      }

      if (dependencies.astro) {
        return 'astro';
      }

      if (dependencies['@nuxt/core']) {
        return 'nuxt';
      }

      if (dependencies['@qwik-city/qwik']) {
        return 'qwik';
      }

      if (dependencies['@expo/react-native']) {
        return 'expo';
      }

      if (dependencies['react-native']) {
        return 'react-native';
      }

      // Check for build tools
      if (dependencies.vite) {
        return 'vite';
      }

      if (dependencies.webpack) {
        return 'webpack';
      }

      if (dependencies.parcel) {
        return 'parcel';
      }

      if (dependencies.rollup) {
        return 'rollup';
      }

      // Default to Node.js if package.json exists
      return 'nodejs';
    } catch (error) {
      console.error('Error parsing package.json:', error);
    }
  }

  // Check for other framework indicators
  if (files['next.config.js'] || files['next.config.ts']) {
    return 'nextjs';
  }

  if (files['remix.config.js'] || files['remix.config.ts']) {
    return 'remix';
  }

  if (files['vite.config.js'] || files['vite.config.ts']) {
    return 'vite';
  }

  if (files['nuxt.config.js'] || files['nuxt.config.ts']) {
    return 'nuxt';
  }

  if (files['svelte.config.js'] || files['svelte.config.ts']) {
    return 'sveltekit';
  }

  if (files['astro.config.js'] || files['astro.config.ts']) {
    return 'astro';
  }

  if (files['angular.json']) {
    return 'angular';
  }

  if (files['vue.config.js'] || files['vue.config.ts']) {
    return 'vue';
  }

  if (files['app.json'] && files['app.json'].includes('expo')) {
    return 'expo';
  }

  if (files['app.json'] && files['app.json'].includes('react-native')) {
    return 'react-native';
  }

  // Check for static site indicators
  if (files['index.html']) {
    return 'static';
  }

  // Default to unknown
  return 'other';
};

// Add loader function to handle GET requests
async function vercelDeployLoader({ request }: { request: Request; context?: any }) {
  const credentialError = clientExposedCredentialError();

  if (credentialError) {
    return Response.json({ error: credentialError }, { status: 500 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const token = readBearerToken(request);

  if (!projectId) {
    return Response.json({ error: 'Missing projectId' }, { status: 400 });
  }

  if (!token) {
    return Response.json({ error: 'Missing bearer token' }, { status: 401 });
  }

  if (isZesOwnedProject(projectId)) {
    return Response.json(
      { error: 'This project is released by the ZES release pipeline and cannot be deployed through this endpoint' },
      { status: 403 },
    );
  }

  try {
    // Get project info
    const projectData = await readProject(token, projectId);

    if (!projectData) {
      return Response.json({ error: 'Failed to fetch project' }, { status: 400 });
    }

    if (!(await tokenBelongsToProjectAccount(token, projectData.account?.id))) {
      return Response.json(
        { error: 'The supplied token does not belong to the account that owns the project' },
        { status: 403 },
      );
    }

    // Get latest deployment
    const deploymentsResponse = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!deploymentsResponse.ok) {
      return Response.json({ error: 'Failed to fetch deployments' }, { status: 400 });
    }

    const deploymentsData = (await deploymentsResponse.json()) as any;

    const latestDeployment = deploymentsData.deployments?.[0];

    return Response.json({
      project: {
        id: projectData.id,
        name: projectData.name,
        url: `https://${projectData.name}.vercel.app`,
      },
      deploy: latestDeployment
        ? {
            id: latestDeployment.id,
            state: latestDeployment.state,
            url: latestDeployment.url ? `https://${latestDeployment.url}` : `https://${projectData.name}.vercel.app`,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching Vercel deployment:', error);
    return Response.json({ error: 'Failed to fetch deployment' }, { status: 500 });
  }
}

interface DeployRequestBody {
  projectId?: string;
  files?: Record<string, string>;
  sourceFiles?: Record<string, string>;
  token?: string;
  chatId: string;
  framework?: string;
}

// Existing action function for POST requests
async function vercelDeployAction({ request }: { request: Request; context?: any }) {
  try {
    const credentialError = clientExposedCredentialError();

    if (credentialError) {
      return Response.json({ error: credentialError }, { status: 500 });
    }

    const body = (await request.json()) as DeployRequestBody;
    const { projectId, files, sourceFiles, chatId, framework } = body;
    const token = body.token || readBearerToken(request);

    if (!token) {
      return Response.json({ error: 'Not connected to Vercel' }, { status: 401 });
    }

    if (isZesOwnedProject(projectId)) {
      return Response.json(
        { error: 'This project is released by the ZES release pipeline and cannot be deployed through this endpoint' },
        { status: 403 },
      );
    }

    let targetProjectId = projectId;
    let projectInfo: VercelProjectInfo | undefined;

    // Detect framework from the source files if not provided
    let detectedFramework = framework;

    if (!detectedFramework && sourceFiles) {
      detectedFramework = detectFramework(sourceFiles);
      console.log('Detected framework from source files:', detectedFramework);
    }

    // If no projectId provided, create a new project
    if (!targetProjectId) {
      const projectName = `bolt-diy-${chatId}-${Date.now()}`;

      const createProjectResponse = await fetch('https://api.vercel.com/v9/projects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectName,
          framework: detectedFramework || null,
        }),
      });

      if (!createProjectResponse.ok) {
        const errorData = (await createProjectResponse.json()) as any;
        return Response.json(
          { error: `Failed to create project: ${errorData.error?.message || 'Unknown error'}` },
          { status: 400 },
        );
      }

      const newProject = (await createProjectResponse.json()) as any;
      targetProjectId = newProject.id;
      projectInfo = {
        id: newProject.id,
        name: newProject.name,
        url: `https://${newProject.name}.vercel.app`,
        chatId,
      };
    } else {
      // Get existing project info
      const existingProject = await readProject(token, targetProjectId);

      if (existingProject) {
        if (!(await tokenBelongsToProjectAccount(token, existingProject.account?.id))) {
          return Response.json(
            { error: 'The supplied token does not belong to the account that owns the project' },
            { status: 403 },
          );
        }

        projectInfo = {
          id: existingProject.id,
          name: existingProject.name,
          url: `https://${existingProject.name}.vercel.app`,
          chatId,
        };
      } else {
        // If project doesn't exist, create a new one
        const projectName = `bolt-diy-${chatId}-${Date.now()}`;

        const createProjectResponse = await fetch('https://api.vercel.com/v9/projects', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: projectName,
            framework: detectedFramework || null,
          }),
        });

        if (!createProjectResponse.ok) {
          const errorData = (await createProjectResponse.json()) as any;
          return Response.json(
            { error: `Failed to create project: ${errorData.error?.message || 'Unknown error'}` },
            { status: 400 },
          );
        }

        const newProject = (await createProjectResponse.json()) as any;
        targetProjectId = newProject.id;
        projectInfo = {
          id: newProject.id,
          name: newProject.name,
          url: `https://${newProject.name}.vercel.app`,
          chatId,
        };
      }
    }

    if (isZesOwnedProject(targetProjectId)) {
      return Response.json(
        { error: 'This project is released by the ZES release pipeline and cannot be deployed through this endpoint' },
        { status: 403 },
      );
    }

    // Prepare files for deployment
    const deploymentFiles = [];

    /*
     * For frameworks that need to build on Vercel, include source files
     * For static sites, only include build output
     */
    const shouldIncludeSourceFiles =
      detectedFramework &&
      ['nextjs', 'react', 'vite', 'remix', 'nuxt', 'sveltekit', 'astro', 'vue', 'angular'].includes(detectedFramework);

    const selectedFiles = shouldIncludeSourceFiles && sourceFiles ? sourceFiles : (files ?? {});
    const selectedEntries = Object.entries(selectedFiles);

    if (selectedEntries.length > MAX_DEPLOYMENT_FILES) {
      return Response.json(
        { error: `Too many files: ${selectedEntries.length} exceeds the limit of ${MAX_DEPLOYMENT_FILES}` },
        { status: 413 },
      );
    }

    let totalBytes = 0;

    for (const [filePath, content] of selectedEntries) {
      const normalizedPath = normalizeDeploymentPath(filePath);

      if (!normalizedPath) {
        return Response.json({ error: `Invalid file path: ${filePath}` }, { status: 400 });
      }

      const size = byteLength(content);

      if (size > MAX_FILE_BYTES) {
        return Response.json(
          { error: `File too large: ${filePath} exceeds the limit of ${MAX_FILE_BYTES} bytes` },
          { status: 413 },
        );
      }

      totalBytes += size;

      if (totalBytes > MAX_TOTAL_BYTES) {
        return Response.json(
          { error: `Deployment payload exceeds the limit of ${MAX_TOTAL_BYTES} bytes` },
          { status: 413 },
        );
      }

      deploymentFiles.push({
        file: normalizedPath,
        data: content,
      });
    }

    // Create deployment configuration based on framework
    const deploymentConfig: any = {
      name: projectInfo.name,
      project: targetProjectId,
      target: 'production',
      files: deploymentFiles,
    };

    // Add framework-specific configuration
    if (detectedFramework === 'nextjs') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = '.next';
    } else if (detectedFramework === 'react' || detectedFramework === 'vite') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'remix') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'public';
    } else if (detectedFramework === 'nuxt') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = '.output';
    } else if (detectedFramework === 'sveltekit') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'build';
    } else if (detectedFramework === 'astro') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'vue') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'angular') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else {
      // For static sites, no build command needed
      deploymentConfig.routes = [{ src: '/(.*)', dest: '/$1' }];
    }

    // Create a new deployment
    const deployResponse = await fetch(`https://api.vercel.com/v13/deployments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deploymentConfig),
    });

    if (!deployResponse.ok) {
      const errorData = (await deployResponse.json()) as any;
      return Response.json(
        { error: `Failed to create deployment: ${errorData.error?.message || 'Unknown error'}` },
        { status: 400 },
      );
    }

    const deployData = (await deployResponse.json()) as any;

    // Poll for deployment status
    let retryCount = 0;

    const maxRetries = 60;

    let deploymentUrl = '';
    let deploymentState = '';

    while (retryCount < maxRetries) {
      const statusResponse = await fetch(`https://api.vercel.com/v13/deployments/${deployData.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (statusResponse.ok) {
        const status = (await statusResponse.json()) as any;
        deploymentState = status.readyState;
        deploymentUrl = status.url ? `https://${status.url}` : '';

        if (status.readyState === 'READY' || status.readyState === 'ERROR') {
          break;
        }
      }

      retryCount++;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (deploymentState === 'ERROR') {
      return Response.json({ error: 'Deployment failed' }, { status: 500 });
    }

    if (retryCount >= maxRetries) {
      return Response.json({ error: 'Deployment timed out' }, { status: 500 });
    }

    return Response.json({
      success: true,
      deploy: {
        id: deployData.id,
        state: deploymentState,

        // Return public domain as deploy URL and private domain as fallback.
        url: projectInfo.url || deploymentUrl,
      },
      project: projectInfo,
    });
  } catch (error) {
    console.error('Vercel deploy error:', error);
    return Response.json({ error: 'Deployment failed' }, { status: 500 });
  }
}

export const loader = withSecurity(vercelDeployLoader, {
  allowedMethods: ['GET'],
});

export const action = withSecurity(vercelDeployAction, {
  allowedMethods: ['POST'],
});
