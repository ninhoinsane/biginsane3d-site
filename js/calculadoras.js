/* Big Insane 3D */
(function () {
function n(el){var v=(typeof el==='string'?document.getElementById(el):el).value.trim().replace(',','.');var x=parseFloat(v);return isFinite(x)?x:NaN}
function f(x,d){return x.toFixed(d).replace('.',',')}
function brl(x){return 'R$ '+x.toFixed(2).replace('.',',')}

function calcFlow(){
  var cur=n('f_cur'),w=n('f_w'),ms=[],o=document.getElementById('f_out');
  document.querySelectorAll('.f_m').forEach(function(i){var v=n(i);if(v>0)ms.push(v)});
  if(!ms.length||!(cur>0)||!(w>0)){o.innerHTML='Digite pelo menos uma medida.';return}
  var avg=ms.reduce(function(a,b){return a+b},0)/ms.length;
  var nf=cur*w/avg, diff=(avg-w)/w*100;
  var msg=Math.abs(diff)<2?'<span class="ok">Já está muito perto do ideal.</span>':(avg>w?'Saindo plástico a mais: o flow vai diminuir.':'Saindo plástico a menos: o flow vai aumentar.');
  o.innerHTML='Média medida: '+f(avg,3)+' mm ('+(diff>0?'+':'')+f(diff,1)+'%)<br>Novo flow ratio: <b>'+f(nf,2)+'</b><br>'+msg;
}
document.querySelectorAll('#flow input').forEach(function(i){i.addEventListener('input',calcFlow)});

function calcVol(){
  var fl=n('v_flow'),h=n('v_h'),w=n('v_w'),sp=n('v_sp'),o=document.getElementById('v_out');
  if(!(fl>0&&h>0&&w>0)){o.innerHTML='Preencha fluxo, camada e largura.';return}
  var max=fl/(h*w);
  var s='Velocidade máxima real: <b>'+Math.floor(max)+' mm/s</b><br>Com margem de 10%: '+Math.floor(max*0.9)+' mm/s';
  if(sp>0){var need=sp*h*w;s+='<br><br>'+f(sp,0)+' mm/s exigem '+f(need,1)+' mm³/s: '+(need<=fl*0.9?'<span class="ok">dentro do limite.</span>':(need<=fl?'<span class="bad">no limite, pode falhar.</span>':'<span class="bad">acima do limite, vai subextrudar.</span>'))}
  o.innerHTML=s;
}
document.getElementById('v_mat').addEventListener('change',function(){if(this.value)document.getElementById('v_flow').value=this.value;calcVol()});
document.querySelectorAll('#vol input').forEach(function(i){i.addEventListener('input',calcVol)});

function calcCusto(){
  var g=n('c_g'),kg=n('c_kg'),h=n('c_h'),w=n('c_w'),kwh=n('c_kwh'),wear=n('c_wear'),fail=n('c_fail'),mult=n('c_mult'),o=document.getElementById('c_out');
  if([g,kg,h,w,kwh,wear,fail,mult].some(function(x){return isNaN(x)})){o.innerHTML='Preencha todos os campos.';return}
  var mat=g/1000*kg, en=h*w/1000*kwh, de=h*wear, base=mat+en+de, fa=base*fail/100, tot=base+fa;
  o.innerHTML='Material: '+brl(mat)+'<br>Energia: '+brl(en)+'<br>Desgaste: '+brl(de)+'<br>Margem de falha: '+brl(fa)+'<br>Custo total: <b>'+brl(tot)+'</b><br>Preço sugerido de venda: <b>'+brl(tot*mult)+'</b>';
}
document.querySelectorAll('#custo input').forEach(function(i){i.addEventListener('input',calcCusto)});

function calcCap(){
  var mn=n('p_min'),lote=n('p_lote'),h=n('p_h'),d=n('p_d'),tr=n('p_troca'),fail=n('p_fail'),pr=n('p_preco'),cu=n('p_custo'),o=document.getElementById('p_out');
  if(!(mn>0&&lote>0&&h>0&&d>0)||[tr,fail,pr,cu].some(function(x){return isNaN(x)})){o.innerHTML='Preencha todos os campos.';return}
  var horas=h*d, ciclo=(mn+tr)/60, mesas=Math.floor(horas/ciclo), boas=Math.floor(mesas*lote*(1-fail/100));
  var lucro=boas*(pr-cu), porHora=(pr-cu)*lote*(1-fail/100)/ciclo;
  o.innerHTML='Horas de máquina no mês: '+f(horas,0)+' h<br>Peças boas por mês: <b>'+boas+'</b><br>Faturamento máximo: '+brl(boas*pr)+'<br>Lucro bruto máximo: <b>'+brl(lucro)+'</b><br>Ganho por hora de máquina: <b>'+brl(porHora)+'</b><br><span style="font-size:13px">Planeje vender 50 a 70% disso: '+brl(lucro*0.5)+' a '+brl(lucro*0.7)+' de lucro.</span>';
}
document.querySelectorAll('#capacidade input').forEach(function(i){i.addEventListener('input',calcCap)});

calcFlow();calcVol();calcCusto();calcCap();
})();
