// yaml_template_list.js
const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const yamlTemplates = [
  {
    label: 'Blog Post',
    content: `---\ntitle: Blog Title\ndate: ${getTodayStr()}\ntags: [tag_1, tag_2]\nimage: /notebook_thumbnails/default.jpg\ndescription: Blog description.\ndraft: true\n---\n\n`
  },
  {
    label: 'LLM Entry',
    content: `---\ntitle: "Title of post"\nllm_Model: "Model name"\nprompt_version: 4\ncategory: [category_1, category_2]\ntags: [tag_1, tag_2, tag_3, tag_4]\ndate: ${getTodayStr()}\ndescription: "A short description of the post."\n---\n\n`
  }
  // Add as many as you want here!
];


const mdTemplates = [
  {
    label: 'Recipe',
    content: `# Recipe Name\n\n## Ingredients\n- \n- \n- \n## Instructions\n1. \n2. \n3. \n## Notes\n\n`
  },
  {
    label: 'To do',
    content: `# To Do List\n\n## High Priority\n- [ ] \n- [ ] \n## Normal\n- [ ] \n- [ ] \n## Low Priority\n- [ ] \n- [ ] \n\n`
  },
  {
    label: 'Workout program',
    content: `# Workout Program\n\n## Monday: Chest & Triceps\n- Bench Press: 3x8-12\n- Tricep Extensions: 3x10-15 \n## Wednesday: Back & Biceps\n- Pull-ups: 3xAMRAP\n- Bicep Curls: 3x10-15\n\n## Friday: Legs & Core\n- Squats: 3x8-12\n- Planks: 3x60s\n\n`
  },
  {
    label: 'Grocery list',
    content: `# Grocery List\n\n## Produce\n- [ ] \n- [ ] \n\n## Dairy / Meat\n- [ ] \n- [ ] \n\n## Pantry\n- [ ] \n- [ ] \n\n`
  }
];