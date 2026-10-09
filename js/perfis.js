/* Big Insane 3D */
(function () {
document.querySelectorAll('pre.cfg').forEach(function(p){
  var b=document.createElement('button');b.className='copy';b.type='button';b.textContent='copiar';
  b.onclick=function(){
    var t=p.firstChild.nodeValue||p.innerText;
    try{navigator.clipboard.writeText(t).then(function(){b.textContent='copiado';setTimeout(function(){b.textContent='copiar'},1500)})}catch(e){}
  };
  p.appendChild(b);
});
})();
