import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLElement;
  Args: {};
  Blocks: {};
}

const SearchBar: TemplateOnlyComponent<Signature> = <template>
  Search Bar Here!
</template>;

export default SearchBar;
