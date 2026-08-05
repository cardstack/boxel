import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { LocalPath } from '@cardstack/runtime-common';

import Directory from './directory';

interface Signature {
  Args: {
    realmURL: string;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileIntent?: (entryPath: LocalPath) => void;
    onFileSelected?: (entryPath: LocalPath) => Promise<void>;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    onDeleteFile?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
  };
}

const FileTree: TemplateOnlyComponent<Signature> = <template>
  <nav>
    <Directory
      @relativePath=''
      @realmURL={{@realmURL}}
      @selectedFile={{@selectedFile}}
      @openDirs={{@openDirs}}
      @onFileIntent={{@onFileIntent}}
      @onFileSelected={{@onFileSelected}}
      @onDirectorySelected={{@onDirectorySelected}}
      @onDeleteFile={{@onDeleteFile}}
      @scrollPositionKey={{@scrollPositionKey}}
    />
  </nav>

  <style scoped>
    nav {
      position: relative;
    }
  </style>
</template>;

export default FileTree;
